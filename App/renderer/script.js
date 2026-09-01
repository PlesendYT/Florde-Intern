// ==================== AUDIT LOG ====================

function setToggle(name, value) {
  const el = document.querySelector('.settings-toggle[data-setting="' + name + '"]');
  if (!el) return;
  if (value) el.classList.add('on'); else el.classList.remove('on');
}
function getToggle(name) {
  const el = document.querySelector('.settings-toggle[data-setting="' + name + '"]');
  return el ? el.classList.contains('on') : false;
}

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

let _requestInterval = null;

function clearRequestTimeout() {
  if (_timeoutTimer) { clearTimeout(_timeoutTimer); _timeoutTimer = null; }
  if (_timeoutEl) { _timeoutEl.remove(); _timeoutEl = null; }
  if (_requestInterval) { clearInterval(_requestInterval); _requestInterval = null; }
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
  _requestInterval = setInterval(() => {
    const remaining = totalMs - (Date.now() - start);
    if (remaining <= 0) { clearInterval(_requestInterval); _requestInterval = null; return; }
    const secs = Math.ceil(remaining / 1000);
    const mins = Math.floor(secs / 60);
    const secStr = (secs % 60).toString().padStart(2, '0');
    if (secs < 300 && _timeoutEl) {
      _timeoutEl.textContent = 'Timeout: ' + mins + ':' + secStr;
    } else if (secs >= 300 && _timeoutEl) {
      _timeoutEl.textContent = 'Timeout: ' + minutes + 'm';
      clearInterval(_requestInterval); _requestInterval = null;
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
    let endpoint = (url || prov.baseUrl || '').replace(/\/+$/, '');
    if (!/\/(chat\/completions|messages|api\/chat|generateContent|v\d+\/chat\/completions)(\?|$)/.test(endpoint)) {
      if (providerId === 'ollama') endpoint += '/api/chat';
      else endpoint += '/chat/completions';
    }
    const r = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model: model || prov.model || 'default', messages: testMsg, max_tokens: 5 }),
      },
      180000
    );
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
    { type: 'function', function: { name: 'edit_file', description: 'Make a surgical text replacement in an existing file. Use this for small changes instead of rewriting the whole file with write_file.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to project root' }, oldString: { type: 'string', description: 'Exact text to find and replace. Must match the file content exactly.' }, newString: { type: 'string', description: 'Replacement text' }, replaceAll: { type: 'boolean', description: 'If true, replace all occurrences of oldString. If false (default), only replace the first occurrence.' }, description: { type: 'string', description: 'Brief 2-5 word summary of the edit' } }, required: ['path', 'oldString', 'newString'] } } },
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
    { type: 'function', function: { name: 'spawn_subagent', description: 'Delegate a subtask to a subagent that works autonomously. The subagent has its own AI conversation and tool access, but cannot spawn further subagents. Returns the subagent ID for status tracking.', parameters: { type: 'object', properties: { goal: { type: 'string', description: 'Clear, detailed description of what the subagent should accomplish' }, context: { type: 'string', description: 'Context from the parent task that the subagent needs to know (files, state, decisions, etc.)' } }, required: ['goal', 'context'] } } },
  ];
  const activeProvider = resolveProvider();
  const modelName = activeProvider?.provider?.model;
  const meta = modelName ? MODEL_META[modelName] : null;
  if (meta && meta.tasks && meta.tasks.vision) {
    baseTools.push({ type: 'function', function: { name: 'vision_request', description: 'Request permission to see the VM screen (vision) for the current task. Use this instead of take_screenshot when a vision-capable model needs to look at the screen.', parameters: { type: 'object', properties: { description: { type: 'string', description: 'What you want to look at' } }, required: [] } } });
  }
  const appTools = _getAppToolDefs();
  const pluginTools = typeof pluginRegistry !== 'undefined' ? pluginRegistry.getActiveTools() : [];
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
}

function buildToolReminder() {
  const tools = getActiveTools();
  if (!tools || tools.length === 0) return 'No tools available.';
  const names = tools.map(t => t.function?.name).filter(Boolean);
  return 'Tools: ' + names.join(', ') + '\nRule: ONLY Tool Call OR ONLY Text. No self-questions. >>| thoughts in these blocks |<<';
}

// ==================== VISION SESSION ====================
const VisionSession = {
  active: false,
  taskId: null,
  startedAt: null,
  allowed: false,

  requestAccess(taskId) {
    this.active = true;
    this.taskId = taskId || Date.now().toString();
    this.startedAt = Date.now();
    AuditLog.log({ type: 'vision', action: 'Vision Session gestartet', status: 'auto', summary: 'Vision Session gestartet (Aufgabe: ' + this.taskId + ')', details: { taskId: this.taskId }, source: 'KI' });
    document.getElementById('btn-send').innerHTML = 'Stop';
    this._notify(false);
    return 'Die KI hat um Bildschirm-Zugriff (Vision) für diese Aufgabe gebeten.';
  },

  grant() {
    this.allowed = true;
    AuditLog.log({ type: 'vision', action: 'Vision Erlaubnis nur für diese Aufgabe', status: 'allowed', summary: 'Vision Erlaubnis nur für diese Aufgabe erteilt', details: { taskId: this.taskId }, source: 'User' });
    return 'Vision für diese Aufgabe erlaubt.';
  },

  revoke(reason) {
    if (!this.active) return;
    this.active = false;
    this.allowed = false;
    AuditLog.log({ type: 'vision', action: 'Vision Session beendet (' + reason + ')', status: 'auto', summary: 'Vision Session beendet (' + reason + ')', details: { taskId: this.taskId}, source: reason === 'manual' ? 'User' : 'KI' });
    document.getElementById('btn-send').innerHTML = 'Senden';
    this._notify(true);
  },

  _notify(done) {
    window.__visionSessionActive = !done;
    const badge = document.getElementById('vision-badge');
    if (badge) badge.style.display = done ? 'none' : 'inline-flex';
  }
};

window.__updateTools = function() {
  if (typeof pluginRegistry !== 'undefined' && pluginRegistry._loaded) {
    if (document.getElementById('marketplace-list')) renderPluginMarketplace();
  }
  // Force tool refresh on next AI request by clearing any cached tool state
  const { providerId, provider: prov } = resolveProvider();
  if (prov) {
    prov.supportsTools = undefined;
    checkToolSupport(prov, providerId).then(s => { prov.supportsTools = s; });
  }
};

// ==================== NOTIFICATIONS ====================

function showNotification(type, text, icon) {
  const container = document.getElementById('notification-container');
  const n = document.createElement('div');
  n.className = 'notification ' + type;
  n.innerHTML = '<span class="notification-icon">' + icon + '</span><span class="notification-text">' + escapeHtml(text) + '</span><button class="notification-dismiss">&times;</button>';
  n.querySelector('.notification-dismiss').addEventListener('click', () => n.remove());
  container.appendChild(n);
  setTimeout(() => { if (n.parentNode) n.remove(); }, 6000);
  if (window.electronAPI && window.electronAPI.showNotification) {
    window.electronAPI.showNotification('Florde', text);
  }
}

// Bridge: core/notify-Events an bestehende showNotification rendern (bis Phase C UI-Schicht)
if (window.__coreEvents && window.__coreEvents.on) {
  window.__coreEvents.on('state:notify', (e) => {
    if (e && e.text) showNotification(e.type || 'info', e.text);
  });
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
    const cancelBtn = document.getElementById('btn-question-cancel');
    const cancelHandler = () => {
      modal.classList.add('hidden');
      resolve('[User cancelled]');
    };
    cancelBtn.removeEventListener('click', cancelHandler);
    cancelBtn.addEventListener('click', cancelHandler);
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
  _timeoutMs() { return (parseInt(document.getElementById('settings-timeout')?.value) || 30) * 60 * 1000; }
  async _post(url, body, timeoutMs) {
    if (timeoutMs === undefined) timeoutMs = this._timeoutMs();
    const r = await fetchWithTimeout(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    }, timeoutMs);
    if (!r.ok) { const detail = await r.json().catch(() => ({})); throw new Error(`OpenCode Zen API error: ${r.status} ${detail.error?.message || r.statusText}`); }
    return r;
  }
  async sendWithTools(messages, tools) {
    const r = await this._post(this.baseUrl, this._withTemp({ model: this.model, messages, tools, tool_choice: 'auto', stream: false }));
    const text = await r.text();
    try { const data = JSON.parse(text); return data.choices?.[0]?.message || { content: '', role: 'assistant' }; }
    catch { throw new Error('OpenCode Zen API: invalid JSON response'); }
  }
  async sendPlain(messages) {
    const r = await this._post(this.baseUrl, this._withTemp({ model: this.model, messages, stream: false }));
    const text = await r.text();
    try { const data = JSON.parse(text); return data.choices?.[0]?.message?.content || ''; }
    catch { throw new Error('OpenCode Zen API: invalid JSON response'); }
  }
}

class OpenCodeGoProvider extends OpenAIProvider {
  constructor(apiKey, model = 'deepseek-v4-flash') { super(apiKey, model); this.apiKey = apiKey; this.model = model; this.baseUrl = 'https://opencode.ai/zen/go/v1/chat/completions'; }
  _timeoutMs() { return (parseInt(document.getElementById('settings-timeout')?.value) || 30) * 60 * 1000; }
  async _post(url, body, timeoutMs) {
    if (timeoutMs === undefined) timeoutMs = this._timeoutMs();
    const r = await fetchWithTimeout(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    }, timeoutMs);
    if (!r.ok) { const detail = await r.json().catch(() => ({})); throw new Error(`OpenCode Go API error: ${r.status} ${detail.error?.message || r.statusText}`); }
    return r;
  }
  async sendWithTools(messages, tools) {
    const r = await this._post(this.baseUrl, this._withTemp({ model: this.model, messages, tools, tool_choice: 'auto', stream: false }));
    const text = await r.text();
    try { const data = JSON.parse(text); return data.choices?.[0]?.message || { content: '', role: 'assistant' }; }
    catch { throw new Error('OpenCode Go API: invalid JSON response'); }
  }
  async sendPlain(messages) {
    const r = await this._post(this.baseUrl, this._withTemp({ model: this.model, messages, stream: false }));
    const text = await r.text();
    try { const data = JSON.parse(text); return data.choices?.[0]?.message?.content || ''; }
    catch { throw new Error('OpenCode Go API: invalid JSON response'); }
  }
}

class OllamaProvider {
  constructor(baseUrl = 'http://localhost:11434', model = 'qwen2.5-coder') { this.baseUrl = baseUrl.replace(/\/+$/, ''); this.model = model; this._useChat = true; this.supportsTools = undefined; }
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
        chatBody.stream = !!onChunk;
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
      } else {
        throw err;
      }
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
      if (m.role === 'tool') {
        msgs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content || '' }] });
      } else {
        msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content || '' });
      }
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
    const systemParts = [];
    for (const m of messages) {
      if (m.role === 'system') { systemParts.push(m.content || ''); continue; }
      contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content || '' }] });
    }
    return { contents, systemInstruction: systemParts.length > 0 ? { parts: [{ text: systemParts.join('\n') }] } : undefined };
  }
  _fromGemini(data) {
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
    return { content: text, role: 'assistant' };
  }
  async sendMessage(messages, onChunk) {
    const { contents, systemInstruction } = this._toGemini(messages);
    const body = { contents };
    if (systemInstruction) body.systemInstruction = systemInstruction;
    const r = await this._post(`streamGenerateContent?alt=sse`, body, CLOUD_TIMEOUT);
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
    const { contents, systemInstruction } = this._toGemini(messages);
    const body = { contents };
    if (systemInstruction) body.systemInstruction = systemInstruction;
    if (tools) body.tools = [{ function_declarations: tools.map(t => t.function) }];
    const r = await this._post(`generateContent`, body);
    const data = await r.json();
    return this._fromGemini(data);
  }
  async sendPlain(messages) {
    const { contents, systemInstruction } = this._toGemini(messages);
    const body = { contents };
    if (systemInstruction) body.systemInstruction = systemInstruction;
    const r = await this._post(`generateContent`, body);
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

// ==================== FULLSCREEN ====================

async function toggleFullscreen() {
  if (!window.electronAPI) return;
  const currentState = await window.electronAPI.isFullScreen();
  await window.electronAPI.setFullscreen(!currentState);
}

// ==================== KEYBOARD SHORTCUTS (Chat) ====================

document.addEventListener('keydown', (e) => {
  if (e.key === 'F11') {
    e.preventDefault();
    toggleFullscreen();
  }
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
let capabilityCache = (() => { try { return JSON.parse(localStorage.getItem('florde-capability-cache') || '{}'); } catch { return {}; } })();
// Clear stale cache so tool support is properly detected
for (const key of Object.keys(capabilityCache)) {
  if (key.startsWith('ollama:') || key.startsWith('opencodezen:') || key.startsWith('opencodego:')) {
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
    const saved = (() => { try { return JSON.parse(localStorage.getItem('florde-settings') || '{}'); } catch { return {}; } })();
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
      if (typeof LayoutManager !== 'undefined' && LayoutManager.isInitialized) {
        LayoutManager.save('project-' + currentProject);
      }
      try { await saveSession(); } catch (e) { console.error('saveSession error:', e); }
      if (typeof TimeTracking !== 'undefined') {
        TimeTracking.stop();
      }
    }
    try {
      await openProject(ws.path);
    } catch (e) {
      console.error('openProject failed:', e);
      showAppView();
      logToTerminal('Error opening project: ' + (e.message || e), 'error');
    }
  },

  _renderTabs() {
    const bar = document.getElementById('workspace-tab-bar');
    if (!bar) return;
    bar.innerHTML = this._workspaces.map(w => `<div class="ws-tab ${w.id === this._activeWorkspaceId ? 'active' : ''}" data-id="${w.id}">
      <span class="ws-tab-name">${escapeHtml(w.name)}</span>
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
    const settings = (() => { try { return JSON.parse(localStorage.getItem('florde-settings') || '{}'); } catch { return {}; } })();
    settings.workspaces = this._workspaces.map(w => ({ id: w.id, name: w.name, path: w.path }));
    localStorage.setItem('florde-settings', JSON.stringify(settings));
  }
};

// ==================== FAVORITES ====================

const Favorites = {
  _favorites: [],

  init() {
    const settings = (() => { try { return JSON.parse(localStorage.getItem('florde-settings') || '{}'); } catch { return {}; } })();
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
    const settings = (() => { try { return JSON.parse(localStorage.getItem('florde-settings') || '{}'); } catch { return {}; } })();
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
    const settings = (() => { try { return JSON.parse(localStorage.getItem('florde-settings') || '{}'); } catch { return {}; } })();
    this._rules = settings.permissions || {};
    const allTools = ['read_file', 'write_file', 'delete_file', 'edit_file', 'list_files', 'search_files', 'exec_command', 'ask_question', 'rename_file', 'take_screenshot', 'schedule_task', 'spawn_subagent', 'browser_open', 'browser_click', 'browser_type', 'browser_screenshot', 'browser_back', 'browser_forward', 'browser_reload', 'browser_evaluate', ...APP_TOOL_NAMES];
    allTools.forEach(t => { if (this._rules[t] === undefined) this._rules[t] = 'ask'; });
  },

  _resolveGroup(toolName) {
    if (toolName.startsWith('browser_')) return 'browser';
    if (toolName.startsWith('git_')) return 'git';
    if (toolName === 'exec_command') return 'terminal';
    if (typeof APP_TOOL_NAMES !== 'undefined' && APP_TOOL_NAMES.includes(toolName)) return 'mcp';
    return null;
  },

  getPermission(toolName) {
    if (this._rules[toolName] !== undefined) return this._rules[toolName];
    const group = this._resolveGroup(toolName);
    if (group && this._rules[group] !== undefined) return this._rules[group];
    return 'allow';
  },

  setPermission(toolName, level) {
    this._rules[toolName] = level;
    const settings = (() => { try { return JSON.parse(localStorage.getItem('florde-settings') || '{}'); } catch { return {}; } })();
    settings.permissions = this._rules;
    localStorage.setItem('florde-settings', JSON.stringify(settings));
  },

  _getAutoExceptions() {
    const s = (() => { try { return JSON.parse(localStorage.getItem('florde-settings') || '{}'); } catch { return {}; } })();
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
    const autoAccept = (() => { try { return JSON.parse(localStorage.getItem('florde-settings') || '{}'); } catch { return {}; } })().autoAccept === true;
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
      AuditLog.log({ type: _toolAuditType(toolName), action: formatToolActivity(toolName, args), status: 'auto', summary: 'Automatisch erlaubt: ' + formatToolActivity(toolName, args), details: { tool: toolName, args: JSON.stringify(args) }, source: 'KI' });
      return true;
    }
    const level = this.getPermission(toolName);
    AuditLog.log({ type: _toolAuditType(toolName), action: formatToolActivity(toolName, args), status: 'auto', summary: 'Automatisch erlaubt (Regel): ' + formatToolActivity(toolName, args), details: { tool: toolName, args: JSON.stringify(args) }, source: 'KI' });
    if (level === 'allow') return true;
    if (level === 'block') {
      AuditLog.log({ type: _toolAuditType(toolName), action: formatToolActivity(toolName, args), status: 'blocked', summary: 'Blockiert (Regel): ' + formatToolActivity(toolName, args), details: { tool: toolName, args: JSON.stringify(args) }, source: 'KI' });
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

function _toolAuditType(toolName) {
  if (toolName === 'exec_command') return 'command';
  if (toolName === 'read_file') return 'file_read';
  if (toolName === 'write_file' || toolName === 'edit_file') return 'file_write';
  if (toolName === 'browser_open') return 'api_access';
  return 'unknown';
}

function _permToolInfo(toolName, args) {
  const info = { icon: '', action: '', path: '', linesAdded: 0, linesRemoved: 0, hasLines: false, reason: '', risk: '', riskLabel: '', riskExplanation: '' };
  const reason = args.description || '';
  info.reason = reason;
  switch (toolName) {
    case 'read_file':
      info.icon = '📖'; info.action = 'Read'; info.path = args.path || '';
      info.risk = 'low'; info.riskLabel = 'Low'; info.riskExplanation = 'The AI wants to read a file. No changes to the project.';
      break;
    case 'write_file':
      info.icon = '✏️'; info.action = 'Write'; info.path = args.path || '';
      if (args.content) info.linesAdded = args.content.split('\n').length;
      info.hasLines = true;
      info.risk = 'medium'; info.riskLabel = 'Medium'; info.riskExplanation = 'The AI wants to write a file. This may overwrite existing code.';
      break;
    case 'edit_file':
      info.icon = '🔧'; info.action = 'Edit'; info.path = args.path || '';
      if (args.oldString) info.linesRemoved = args.oldString.split('\n').length;
      if (args.newString) info.linesAdded = args.newString.split('\n').length;
      info.hasLines = true;
      info.risk = 'medium'; info.riskLabel = 'Medium'; info.riskExplanation = 'The AI wants to replace existing code with new code.';
      break;
    case 'delete_file':
      info.icon = '🗑️'; info.action = 'Delete'; info.path = args.path || '';
      info.risk = 'high'; info.riskLabel = 'High'; info.riskExplanation = 'The AI wants to irreversibly delete a file.';
      break;
    case 'rename_file':
      info.icon = '📝'; info.action = 'Rename'; info.path = (args.path || '') + ' → ' + (args.new_path || '');
      info.risk = 'medium'; info.riskLabel = 'Medium'; info.riskExplanation = 'The AI wants to rename a file. References may break.';
      break;
    case 'exec_command': {
      info.icon = '⚡'; info.action = 'Execute'; info.path = args.command || '';
      const shellRisk = assessShellRisk(args.command || '');
      if (shellRisk === 'critical') { info.risk = 'critical'; info.riskLabel = 'Critical'; }
      else if (shellRisk === 'high') { info.risk = 'high'; info.riskLabel = 'High'; }
      else if (shellRisk === 'medium') { info.risk = 'medium'; info.riskLabel = 'Medium'; }
      else if (shellRisk === 'low') { info.risk = 'low'; info.riskLabel = 'Low'; }
      else { info.risk = 'safe'; info.riskLabel = 'Safe'; }
      info.riskExplanation = 'Risk assessment based on shell command: ' + info.riskLabel;
      break;
    }
    case 'ask_question':
      info.icon = '❓'; info.action = 'Ask'; info.path = args.question || '';
      info.risk = 'low'; info.riskLabel = 'Low'; info.riskExplanation = 'The AI wants to ask a question. No file change.';
      break;
    default:
      info.icon = '🔧'; info.action = toolName; info.path = Object.values(args).filter(v => typeof v === 'string').join(', ').slice(0, 80);
      info.risk = 'medium'; info.riskLabel = 'Medium'; info.riskExplanation = 'The AI wants to perform an action.';
  }
  return info;
}

function showPermissionPrompt(toolName, args, callback) {
  const existing = document.querySelector('.permission-prompt-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'permission-prompt-overlay';
  const info = _permToolInfo(toolName, args);
  const act = formatToolActivity(toolName, args);
  showNotification('warning', 'Action Required: ' + act, '\u{1F512}');

  let linesHtml = '';
  if (info.hasLines) {
    const parts = [];
    if (info.linesAdded > 0) parts.push('<span class="perm-prompt-lines added">+' + info.linesAdded + ' lines</span>');
    if (info.linesRemoved > 0) parts.push('<span class="perm-prompt-lines removed">-' + info.linesRemoved + ' lines</span>');
    if (parts.length) linesHtml = '<div class="perm-prompt-detail"><strong>📊 Changes:</strong> ' + parts.join(', ') + '</div>';
  }

  overlay.innerHTML = '<div class="permission-prompt">' +
    '<h3>\u{1F512} AI Access Request</h3>' +
    '<div class="perm-prompt-icon">' + info.icon + '</div>' +
    '<div class="perm-prompt-action">' + escapeHtml(info.action) + '</div>' +
    (info.path ? '<div class="perm-prompt-detail"><strong>📄 File:</strong> ' + escapeHtml(info.path) + '</div>' : '') +
    linesHtml +
    (info.reason ? '<div class="perm-prompt-reason"><strong>💬 Reason:</strong> ' + escapeHtml(info.reason) + '</div>' : '') +
    '<div class="perm-prompt-risk"><strong>⚠️ Risk:</strong> <span class="perm-risk-badge ' + info.risk + '">' + info.riskLabel + '</span></div>' +
    '<div class="perm-prompt-explain">' + escapeHtml(info.riskExplanation) + '</div>' +
    '<div id="perm-detail-area"></div>' +
    '<div class="perm-prompt-extra-btns">' +
      '<button id="btn-perm-edit">✏️ Edit</button>' +
      '<button id="btn-perm-explain">🔍 Explain in Detail</button>' +
    '</div>' +
    '<hr class="perm-prompt-divider">' +
    '<div class="permission-actions">' +
      '<button class="btn-allow-once" style="background:var(--accent);color:#fff;">✅ Allow Once</button>' +
      '<button class="btn-allow-always">✅ Always Allow</button>' +
      '<button class="btn-block-once" style="background:#ef4444;color:#fff;">❌ Block Once</button>' +
      '<button class="btn-block-always">❌ Always Block</button>' +
    '</div>' +
  '</div>';
  document.body.appendChild(overlay);

  overlay.querySelector('.btn-allow-once').onclick = () => {
    overlay.remove();
    AuditLog.log({ type: _toolAuditType(toolName), action: act, status: 'allowed', summary: act + ' (erlaubt, einmalig)', details: { tool: toolName, args: JSON.stringify(args) }, source: 'KI' });
    callback(true);
  };
  overlay.querySelector('.btn-allow-always').onclick = () => {
    PermissionManager.setPermission(toolName, 'allow');
    overlay.remove();
    AuditLog.log({ type: _toolAuditType(toolName), action: act, status: 'allowed', summary: act + ' (immer erlauben)', details: { tool: toolName, args: JSON.stringify(args) }, source: 'KI' });
    callback(true);
  };
  overlay.querySelector('.btn-block-once').onclick = () => {
    overlay.remove();
    AuditLog.log({ type: _toolAuditType(toolName), action: act, status: 'blocked', summary: act + ' (blockiert, einmalig)', details: { tool: toolName, args: JSON.stringify(args) }, source: 'KI' });
    callback(false);
  };
  overlay.querySelector('.btn-block-always').onclick = () => {
    PermissionManager.setPermission(toolName, 'block');
    overlay.remove();
    AuditLog.log({ type: _toolAuditType(toolName), action: act, status: 'blocked', summary: act + ' (immer blockieren)', details: { tool: toolName, args: JSON.stringify(args) }, source: 'KI' });
    callback(false);
  };

  document.getElementById('btn-perm-edit').onclick = () => _permEditFlow(overlay, toolName, args, callback);
  document.getElementById('btn-perm-explain').onclick = () => _permExplainFlow(overlay, toolName, args);
}

function _permEditFlow(overlay, toolName, args, callback) {
  const detailArea = overlay.querySelector('#perm-detail-area');
  detailArea.innerHTML =
    '<textarea id="perm-edit-textarea" class="perm-prompt-textarea" placeholder="What should be different? (e.g. \'Make Buy Now instead of Buy\')"></textarea>' +
    '<div class="perm-prompt-textarea-row">' +
      '<button id="btn-perm-edit-submit" style="background:var(--accent);border:none;color:#fff;border-radius:4px;padding:0.35rem 0.8rem;cursor:pointer;font-size:0.8rem;">Send</button>' +
      '<button id="btn-perm-edit-cancel" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:0.35rem 0.8rem;cursor:pointer;font-size:0.8rem;">Cancel</button>' +
      '<span id="perm-edit-status" style="font-size:0.75rem;color:var(--text3);margin-left:auto;"></span>' +
    '</div>';

  document.getElementById('btn-perm-edit-submit').onclick = async () => {
    const input = document.getElementById('perm-edit-textarea');
    const status = document.getElementById('perm-edit-status');
    const submitBtn = document.getElementById('btn-perm-edit-submit');
    if (!input.value.trim()) return;
    submitBtn.disabled = true;
    status.textContent = '⏳ Sending to AI...';
    try {
      const { provider: prov } = resolveProvider();
      if (!prov || !prov.sendPlain) { status.textContent = '\u274C No active provider.'; submitBtn.disabled = false; return; }
      const recentMsgs = (typeof chatHistory !== 'undefined' ? chatHistory : []).filter(m => m.role !== 'system').slice(-3);
      const promptText = 'You have prepared a tool call. The user wants a change:\n\n' +
        'Tool: ' + toolName + '\n' +
        'Current arguments: ' + JSON.stringify(args, null, 2) + '\n\n' +
        'User request: ' + input.value.trim() + '\n\n' +
        'Reply ONLY with a valid JSON object containing the new arguments for the same tool call. ' +
        'Keep all fields that the user did not explicitly want to change.';
      const allMsgs = recentMsgs.concat([{ role: 'user', content: promptText }]);
      const resp = await prov.sendPlain(allMsgs, { signal: AbortSignal.timeout(30000) });
      const text = typeof resp === 'string' ? resp : (resp?.content || resp?.message?.content || JSON.stringify(resp));
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON in response');
      const newArgs = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      status.textContent = '✅ Updated!';
      setTimeout(() => { overlay.remove(); showPermissionPrompt(toolName, newArgs, callback); }, 500);
    } catch (e) {
      status.textContent = '❌ Error: ' + (e.message || e);
      submitBtn.disabled = false;
    }
  };
  document.getElementById('btn-perm-edit-cancel').onclick = () => {
    detailArea.innerHTML = '';
  };
}

function _permExplainFlow(overlay, toolName, args) {
  const detailArea = overlay.querySelector('#perm-detail-area');
  if (detailArea.querySelector('.perm-prompt-detail-section')) {
    detailArea.innerHTML = '';
    return;
  }
  detailArea.innerHTML = '<div class="perm-prompt-detail-section loading">⏳ Loading detailed explanation...</div>';
  document.getElementById('btn-perm-explain').disabled = true;

  (async () => {
    try {
      const { provider: prov } = resolveProvider();
      if (!prov || !prov.sendPlain) {
        detailArea.innerHTML = '<div class="perm-prompt-detail-section">\u274C No active provider available.</div>';
        document.getElementById('btn-perm-explain').disabled = false;
        return;
      }
      const recentMsgs = (typeof chatHistory !== 'undefined' ? chatHistory : []).filter(m => m.role !== 'system').slice(-3);
      const promptText = 'Explain in detail what you want to achieve with the following tool call. Describe the purpose, effects, and why this step is necessary.\n\n' +
        'Tool: ' + toolName + '\n' +
        'Arguments: ' + JSON.stringify(args, null, 2);
      const allMsgs = recentMsgs.concat([{ role: 'user', content: promptText }]);
      const resp = await prov.sendPlain(allMsgs, { signal: AbortSignal.timeout(30000) });
      const text = typeof resp === 'string' ? resp : (resp?.content || resp?.message?.content || JSON.stringify(resp));
      detailArea.innerHTML = '<div class="perm-prompt-detail-section">' + escapeHtml(text) + '</div>';
    } catch (e) {
      detailArea.innerHTML = '<div class="perm-prompt-detail-section">❌ Error: ' + escapeHtml(e.message || e) + '</div>';
    }
    document.getElementById('btn-perm-explain').disabled = false;
  })();
}

function showSandboxDeniedUI(toolName, args, callback) {
  const existing = document.querySelector('.permission-prompt-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'permission-prompt-overlay';
  const path = args.path || args.command || args.query || 'unknown';
  overlay.innerHTML = '<div class="permission-prompt" style="border-color:#ef4444;">' +
    '<h3>\u{1F512} Sandbox Access Denied</h3>' +
    '<div class="perm-prompt-icon">🚫</div>' +
    '<div class="perm-prompt-action">Access to: ' + escapeHtml(path) + '</div>' +
    '<pre>' + escapeHtml(JSON.stringify(args, null, 2)) + '</pre>' +
    '<hr class="perm-prompt-divider">' +
    '<div class="permission-actions">' +
      '<button class="btn-allow-once" style="background:#ef4444;color:#fff;">✅ Allow Once</button>' +
      '<button class="btn-allow-always" style="background:#ef4444;color:#fff;">✅ Always Allow</button>' +
      '<button class="btn-block-once">❌ Deny Once</button>' +
      '<button class="btn-block-always">❌ Always Block</button>' +
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
  const holdProgress = holdBtn.querySelector('.hold-progress');
  let holdTimer = null;
  let holdSeconds = 0;
  let holdCompleted = false;
  let holdText = document.createTextNode('Hold 10s to Confirm');
  holdBtn.appendChild(holdText);

  holdBtn.addEventListener('mousedown', () => {
    if (holdCompleted) return;
    if (holdTimer) return;
    holdSeconds = 0;
    holdCompleted = false;
    holdProgress.style.width = '0%';
    holdTimer = setInterval(() => {
      holdSeconds++;
      const pct = (holdSeconds / 10) * 100;
      holdProgress.style.width = pct + '%';
      holdText.textContent = 'Hold ' + (10 - holdSeconds) + 's';
      if (holdSeconds >= 10) {
        clearInterval(holdTimer); holdTimer = null;
        holdCompleted = true;
        holdText.textContent = 'Confirm Execution';
        holdBtn.style.background = '#dc2626';
        holdBtn.onclick = () => { overlay.remove(); callback(true); };
      }
    }, 1000);
  });
  holdBtn.addEventListener('mouseup', () => {
    if (holdCompleted) return;
    if (holdTimer) { clearInterval(holdTimer); holdTimer = null; }
    holdProgress.style.width = '0%';
    holdText.textContent = 'Hold 10s to Confirm';
    holdBtn.style.background = '';
  });
  holdBtn.addEventListener('mouseleave', () => {
    if (holdCompleted) return;
    if (holdTimer) { clearInterval(holdTimer); holdTimer = null; }
    holdProgress.style.width = '0%';
    holdText.textContent = 'Hold 10s to Confirm';
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
    const ci = document.getElementById('chat-input'); if (ci) ci.value = 'What does this command do and what were the results?\n```\n' + command + '\n```\n\nResults:\n```\n' + (result || '') + '\n```';
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
  const providers = ['openai','deepseek','mistral','anthropic','gemini','grok','opencodezen','opencodego','openrouter','custom'];
  for (const p of providers) await autoFillApiKey(p);
}

// ==================== PERMISSION LIST UI ====================

function renderPermissionList() {
  const container = document.getElementById('permission-list');
  if (!container) return;
  const allTools = [
    { id: 'read_file', label: 'Read files' },
    { id: 'write_file', label: 'Write files' },
    { id: 'edit_file', label: 'Edit files' },
    { id: 'rename_file', label: 'Rename files' },
    { id: 'delete_file', label: 'Delete files' },
    { id: 'list_files', label: 'List files' },
    { id: 'search_files', label: 'Search files' },
    { id: 'exec_command', label: 'Run commands' },
    { id: 'ask_question', label: 'Ask questions' },
    { id: 'web_search', label: 'Web search' },
    { id: 'web_fetch', label: 'Web fetch' },
    { id: 'browser', label: 'Browser controls' },
    { id: 'git', label: 'Git operations' },
    { id: 'terminal', label: 'Terminal operations' },
    { id: 'mcp', label: 'MCP tools' },
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
  showModal(modal.id);

  container.querySelectorAll('.keychain-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (window.electronAPI?.keychain) {
        await window.electronAPI.keychain.delete({ key: btn.dataset.key });
        showKeychainManager();
      }
    });
  });
  document.getElementById('btn-close-keychain')?.addEventListener('click', () => hideModal(modal.id));
}

// ==================== PROVIDER RESOLUTION ====================
function resolveProvider() {
  const val = document.getElementById('provider-select')?.value;
  if (!val) return { providerId: null, provider: null, isRoute: false };
  if (val.startsWith('route:')) {
    const route = AIRouter._routes.find(r => r.id === val.slice(6));
    if (!route) return { providerId: null, provider: null, isRoute: true };
    return { providerId: route.provider, provider: AIRouter.getProviderForRoute(route), isRoute: true, route };
  }
  return { providerId: val, provider: providers[val] || null, isRoute: false };
}

// ==================== SYSTEM PROMPT ====================

function buildSystemPrompt(hasTools) {
  const providerValue = document.getElementById('provider-select').value;
  let providerId, prov;
  if (providerValue.startsWith('route:')) {
    const route = AIRouter._routes.find(r => r.id === providerValue.slice(6));
    providerId = route?.provider || 'openai';
    prov = AIRouter.getProviderForRoute(route);
  } else {
    providerId = providerValue;
    prov = providers[providerId];
  }
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
- edit_file(path, oldString, newString): Make surgical text replacements in existing files (use instead of write_file for small changes)
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
Privacy: ${providerId === 'ollama' || providerId === 'lmstudio' || providerId === 'localai' ? '100% Local - no data leaves this PC' : 'Cloud provider - data is encrypted in transit'}
${currentProjectType === 'local' ? 'Notes: This is a local project. Shell commands run in the project root directory. You can use system commands (pip install, npm install, cargo build, etc.) to set up and run the project.' : 'Notes: This is a sandbox project. Files are stored in app data. Shell commands run in the isolated sandbox directory.'}

Zero-Cloud-Storage: All user data, code, and chat history stays in the local database/JSON files.
Encrypted API Communication: Cloud model connections go directly from client to provider - no proxy server.
Local RAG: Project context is built locally. Embeddings are generated via local models.
${promptExtSection}${customSection}${appsSection}`;

  const memFiles = currentProject && window._memoryFileList && window._memoryFileList.length > 0
    ? window._memoryFileList.join(', ') : '';
  const memSection = memFiles ? `

Persistent memory files (.florde/memory/): ${memFiles}
You have persistent project memory files in .florde/memory/. Read them with !memory when you need context.
` : '';

  if (hasTools) {
    return basePrompt + memSection + `


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

WICHTIG — You MUST use tools to write code. NEVER show code only in the chat.

Tool formats (any one is fine):
  [write_file: {"path": "src/main.js", "content": "..."}]
  { "tool": "write_file", "arguments": { "path": "...", "content": "..." } }
  write_file: {"path": "...", "content": "..."}

Rules:
- Use write_file for code changes — never show code in chat
- Always start with list_files to see the structure
- Read files with read_file before making changes
- Use exec_command to test/execute
- >>| Think here, the user sees this as gray text |<<
- Don't ask yourself questions — act directly
- ONLY tool calls or ONLY text, never both mixed

Available Tools:
${toolList}${pluginSection}

RULES:
1. Always start by listing files to understand the project structure
2. Read files before making changes
3. You MUST use write_file to create or modify files — never just show the code in chat
4. Use exec_command to install dependencies, run the project, etc.
5. After making changes, verify with exec_command if appropriate
6. Put thoughts in >>| ... |<< blocks
7. Do NOT self-question. Do NOT write QA-style answers. Just build.
8. When using write_file, delete_file, rename_file, or exec_command, always provide a brief "description" parameter summarizing the action in 2-5 words.`;
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
    const maxIter = 10000;
    let iter = 0;
    while (idx < text.length && depth > 0 && iter < maxIter) {
      if (text[idx] === '{') depth++;
      if (text[idx] === '}') depth--;
      idx++;
      iter++;
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
  // Plain format: tool_name: { json } (no brackets — common in Ollama output)
  const plainRe = /^(\w+):\s*(\{)/gm;
  let pm;
  while ((pm = plainRe.exec(text)) !== null) {
    const name = pm[1];
    let depth = 1;
    let idx = pm.index + pm[0].length;
    const startLine = text.lastIndexOf('\n', pm.index) + 1;
    while (idx < text.length && depth > 0) {
      if (text[idx] === '{') depth++;
      if (text[idx] === '}') depth--;
      idx++;
    }
    if (depth === 0) {
      try {
        const jsonStr = text.slice(pm.index + pm[0].length - 1, idx);
        const args = JSON.parse(jsonStr);
        const raw = text.slice(startLine, idx).trim();
        calls.push({
          function: { name, arguments: jsonStr },
          id: 'plain_' + Date.now() + '_' + calls.length,
          args,
          _raw: raw
        });
      } catch (e) {}
    }
  }
  return calls;
}

// ==================== MODEL META ====================
const MODEL_META = {
  'gpt-4o': { context: 128000, costIn: 2.5, costOut: 10, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: true, tool_calling: true, experimental_tool_calling: false } },
  'gpt-4o-mini': { context: 128000, costIn: 0.15, costOut: 0.6, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'gpt-5.5': { context: 256000, costIn: 5, costOut: 25, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: true, tool_calling: true, experimental_tool_calling: false } },
  'gpt-5.4-mini': { context: 128000, costIn: 0.4, costOut: 1.6, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'gpt-5': { context: 256000, costIn: 2.5, costOut: 10, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: true, tool_calling: true, experimental_tool_calling: false } },
  'gpt-5-mini': { context: 128000, costIn: 0.4, costOut: 1.6, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'gpt-4.1': { context: 1047576, costIn: 2, costOut: 8, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'gpt-4.1-mini': { context: 1047576, costIn: 0.4, costOut: 1.6, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'o3-pro': { context: 200000, costIn: 10, costOut: 40, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'o3': { context: 200000, costIn: 2, costOut: 8, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'o4-mini': { context: 200000, costIn: 1.1, costOut: 4.4, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'o3-mini': { context: 200000, costIn: 1.1, costOut: 4.4, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'claude-opus-4-8': { context: 200000, costIn: 15, costOut: 75, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'claude-opus-4-7': { context: 200000, costIn: 15, costOut: 75, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'claude-opus-4-6': { context: 200000, costIn: 15, costOut: 75, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'claude-sonnet-5': { context: 200000, costIn: 3, costOut: 15, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'claude-sonnet-4-6': { context: 200000, costIn: 3, costOut: 15, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'claude-3.5-haiku': { context: 200000, costIn: 0.8, costOut: 4, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'gemini-3.5-flash': { context: 1048576, costIn: 0, costOut: 0, free: true, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: true, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'gemini-3.1-pro-preview': { context: 1048576, costIn: 1.25, costOut: 10, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: true, tool_calling: true, experimental_tool_calling: false } },
  'gemini-3.1-flash-lite': { context: 1048576, costIn: 0, costOut: 0, free: true },
  'gemini-2.5-flash': { context: 1048576, costIn: 0, costOut: 0, free: true, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: true, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'gemini-2.5-pro': { context: 1048576, costIn: 1.25, costOut: 10, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'deepseek-chat': { context: 64000, costIn: 0.14, costOut: 0.28, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: false, experimental_tool_calling: true } },
  'deepseek-coder': { context: 64000, costIn: 0.14, costOut: 0.28, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: false, experimental_tool_calling: true } },
  'deepseek-reasoner': { context: 64000, costIn: 0.55, costOut: 2.19, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: false, image_generation: false, tool_calling: false, experimental_tool_calling: true } },
  'mistral-large-latest': { context: 131000, costIn: 2, costOut: 6, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'mistral-medium-latest': { context: 131000, costIn: 0.4, costOut: 2, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'mistral-small-latest': { context: 131000, costIn: 0.1, costOut: 0.3, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'ministral-3b-latest': { context: 128000, costIn: 0.04, costOut: 0.04, free: false },
  'devstral-2.0': { context: 256000, costIn: 0.3, costOut: 0.9, free: false, tasks: { coding: true, chatting: false, planning: false, brainstorming: false, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'devstral-1.0': { context: 256000, costIn: 0.3, costOut: 0.9, free: false, tasks: { coding: true, chatting: false, planning: false, brainstorming: false, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'codestral-latest': { context: 256000, costIn: 1, costOut: 3, free: false, tasks: { coding: true, chatting: false, planning: false, brainstorming: false, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'codestral-mamba-latest': { context: 256000, costIn: 0.5, costOut: 1.5, free: false },
  'mistral-tiny-latest': { context: 128000, costIn: 0.1, costOut: 0.3, free: false },
  'grok-4.3': { context: 131072, costIn: 5, costOut: 15, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: true, tool_calling: true, experimental_tool_calling: false } },
  'grok-4.20': { context: 131072, costIn: 5, costOut: 15, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: true, tool_calling: true, experimental_tool_calling: false } },
  'grok-build-0.1': { context: 131072, costIn: 3, costOut: 9, free: false },
  // === OpenCode Zen Models ===
  'big-pickle': { context: 128000, costIn: 0, costOut: 0, free: true, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'deepseek-v4-pro': { context: 128000, costIn: 0.66, costOut: 1.98, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'deepseek-v4-flash': { context: 128000, costIn: 0.22, costOut: 0.66, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'grok-4.6': { context: 200000, costIn: 2, costOut: 6, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: true, tool_calling: true, experimental_tool_calling: false } },
  'grok-4.5': { context: 200000, costIn: 2, costOut: 6, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: true, tool_calling: true, experimental_tool_calling: false } },
  'grok-build-0.1': { context: 131072, costIn: 1, costOut: 2, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'gpt-5.6-sol': { context: 272000, costIn: 2, costOut: 10, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: true, tool_calling: true, experimental_tool_calling: false } },
  'gpt-5.6-terra': { context: 272000, costIn: 2, costOut: 12, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: true, tool_calling: true, experimental_tool_calling: false } },
  'gpt-5.6-luna': { context: 272000, costIn: 0.20, costOut: 1.20, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'gpt-5.5': { context: 272000, costIn: 5, costOut: 30, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: true, tool_calling: true, experimental_tool_calling: false } },
  'gpt-5.5-pro': { context: 272000, costIn: 30, costOut: 180, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: true, tool_calling: true, experimental_tool_calling: false } },
  'gpt-5.4': { context: 272000, costIn: 2.50, costOut: 15, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: true, tool_calling: true, experimental_tool_calling: false } },
  'gpt-5.4-pro': { context: 272000, costIn: 30, costOut: 180, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: true, tool_calling: true, experimental_tool_calling: false } },
  'gpt-5.4-mini': { context: 272000, costIn: 0.75, costOut: 4.50, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'gpt-5.4-nano': { context: 272000, costIn: 0.20, costOut: 1.25, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: false, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'gpt-5.3-codex': { context: 272000, costIn: 1.75, costOut: 14, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'gpt-5.3-codex-spark': { context: 272000, costIn: 1.75, costOut: 14, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'gpt-5': { context: 272000, costIn: 1.07, costOut: 8.50, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: true, tool_calling: true, experimental_tool_calling: false } },
  'gpt-5-nano': { context: 272000, costIn: 0.05, costOut: 0.40, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: false, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'claude-fable-5': { context: 200000, costIn: 10, costOut: 50, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'claude-opus-5': { context: 200000, costIn: 5, costOut: 25, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'claude-sonnet-5': { context: 200000, costIn: 2, costOut: 10, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'claude-haiku-4-5': { context: 200000, costIn: 1, costOut: 5, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'gemini-3.7-flash': { context: 1048576, costIn: 1.50, costOut: 7.50, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: true, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'gemini-3.1-pro': { context: 1048576, costIn: 2, costOut: 12, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'gemini-3-flash': { context: 1048576, costIn: 0.50, costOut: 3, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: true, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'gemini-3.5-flash-lite': { context: 1048576, costIn: 0.30, costOut: 2.50, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'muse-spark-1.2': { context: 131072, costIn: 1.25, costOut: 4.25, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'kimi-k3': { context: 131072, costIn: 3, costOut: 15, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'kimi-k2.7-code': { context: 131072, costIn: 0.95, costOut: 4, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'kimi-k2.6': { context: 131072, costIn: 0.95, costOut: 4, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'qwen3.7-max': { context: 131072, costIn: 2.50, costOut: 7.50, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'qwen3.7-plus': { context: 131072, costIn: 0.40, costOut: 1.60, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'minimax-m3': { context: 131072, costIn: 0.30, costOut: 1.20, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'glm-5.2': { context: 131072, costIn: 1.40, costOut: 4.40, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'nemotron-3-ultra-free': { context: 128000, costIn: 0, costOut: 0, free: true, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'mimo-v2.5-free': { context: 128000, costIn: 0, costOut: 0, free: true, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'hy3-free': { context: 128000, costIn: 0, costOut: 0, free: true, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'x-preview-f-free': { context: 128000, costIn: 0, costOut: 0, free: true, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'nemotron-3.5-lightning-free': { context: 128000, costIn: 0, costOut: 0, free: true, tasks: { coding: true, chatting: true, planning: false, brainstorming: false, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'muse-spark-1.2-contributor-free': { context: 128000, costIn: 0, costOut: 0, free: true, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  // === OpenCode Go Models ===
  'grok-4.5-go': { context: 200000, costIn: 2, costOut: 6, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: true, tool_calling: true, experimental_tool_calling: false } },
  'glm-5.3': { context: 131072, costIn: 1.40, costOut: 4.40, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'glm-5.2-go': { context: 131072, costIn: 1.40, costOut: 4.40, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'glm-5.1': { context: 131072, costIn: 1.40, costOut: 4.40, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'gpt-5.6-luna-go': { context: 272000, costIn: 0.20, costOut: 1.20, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'kimi-k3-go': { context: 131072, costIn: 3, costOut: 15, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'kimi-k2.7-code-go': { context: 131072, costIn: 0.95, costOut: 4, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'kimi-k2.6-go': { context: 131072, costIn: 0.95, costOut: 4, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'longcat-2.0': { context: 131072, costIn: 0.30, costOut: 1.20, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'deepseek-v4-pro-go': { context: 128000, costIn: 0.66, costOut: 1.98, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'deepseek-v4-flash-go': { context: 128000, costIn: 0.22, costOut: 0.66, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'deepseek-v4-flash-vision-exp': { context: 128000, costIn: 0.22, costOut: 0.66, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: true, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'mimo-v2.5': { context: 128000, costIn: 0.14, costOut: 0.28, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'mimo-v2.5-pro': { context: 128000, costIn: 0.435, costOut: 0.87, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'minimax-m3-go': { context: 131072, costIn: 0.30, costOut: 1.20, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'minimax-m2.7': { context: 131072, costIn: 0.30, costOut: 1.20, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'muse-spark-1.2-contributor': { context: 128000, costIn: 0.10, costOut: 0.20, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'qwen3.8-max': { context: 131072, costIn: 2, costOut: 6, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'qwen3.7-max-go': { context: 131072, costIn: 2.50, costOut: 7.50, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'qwen3.7-plus-go': { context: 131072, costIn: 0.40, costOut: 1.60, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'qwen3.6-plus': { context: 131072, costIn: 0.50, costOut: 3, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'hy3': { context: 128000, costIn: 0.14, costOut: 0.58, free: false, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'ox-alpha-free': { context: 128000, costIn: 0, costOut: 0, free: true, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'anthropic/claude-sonnet-4-6': { context: 200000, costIn: 3, costOut: 15, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'openai/gpt-4o': { context: 128000, costIn: 2.5, costOut: 10, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: true, image_generation: true, tool_calling: true, experimental_tool_calling: false } },
  'google/gemini-2.5-flash': { context: 1048576, costIn: 0, costOut: 0, free: true, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: true, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'meta-llama/llama-3.1-70b': { context: 128000, costIn: 0.52, costOut: 0.75, free: false },
  'mistralai/mistral-large': { context: 131000, costIn: 2, costOut: 6, free: false, tasks: { coding: true, chatting: true, planning: true, brainstorming: true, vision: false, image_generation: false, tool_calling: true, experimental_tool_calling: false } },
  'qwen2.5-coder': { context: 131072, costIn: 0, costOut: 0, free: true, local: true, tasks: { coding: true, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: false, experimental_tool_calling: true } },
  'local-model': { context: 131072, costIn: 0, costOut: 0, free: true, local: true, tasks: { coding: false, chatting: true, planning: false, brainstorming: true, vision: false, image_generation: false, tool_calling: false, experimental_tool_calling: false } },
  'custom-model': { context: 128000, costIn: 0, costOut: 0, free: false, tasks: { coding: false, chatting: true, planning: false, brainstorming: false, vision: false, image_generation: false, tool_calling: false, experimental_tool_calling: false } },
};

const MODEL_TASK_DEFAULTS = {
  coding: false, chatting: true, planning: false, brainstorming: true,
  vision: false, image_generation: false, tool_calling: false,
  experimental_tool_calling: false
};

const MODEL_CATALOG = {
  openai: ['gpt-5.5','gpt-5','gpt-5-mini','gpt-5.4-mini','gpt-4o','gpt-4o-mini','gpt-4.1','gpt-4.1-mini','o3-pro','o3','o4-mini','o3-mini'],
  deepseek: ['deepseek-chat','deepseek-coder','deepseek-reasoner','deepseek-v4-flash-free','deepseek-v4-pro'],
  mistral: ['mistral-large-latest','mistral-medium-latest','mistral-small-latest','ministral-3b-latest','devstral-2.0','devstral-1.0','codestral-latest','codestral-mamba-latest','mistral-tiny-latest'],
  anthropic: ['claude-opus-4-8','claude-opus-4-7','claude-opus-4-6','claude-sonnet-5','claude-sonnet-4-6','claude-3.5-haiku'],
  gemini: ['gemini-3.5-flash','gemini-3.1-pro-preview','gemini-3.1-flash-lite','gemini-2.5-flash','gemini-2.5-pro'],
  grok: ['grok-4.3','grok-4.20','grok-build-0.1'],
  opencodezen: ['big-pickle','gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna','gpt-5.5','gpt-5.5-pro','gpt-5.4','gpt-5.4-pro','gpt-5.4-mini','gpt-5.4-nano','gpt-5.3-codex','gpt-5','gpt-5-nano','claude-fable-5','claude-opus-5','claude-sonnet-5','claude-haiku-4-5','gemini-3.7-flash','gemini-3.1-pro','gemini-3-flash','gemini-3.5-flash-lite','muse-spark-1.2','grok-4.6','grok-4.5','grok-build-0.1','kimi-k3','kimi-k2.7-code','kimi-k2.6','qwen3.7-max','qwen3.7-plus','minimax-m3','glm-5.2','deepseek-v4-pro','deepseek-v4-flash','nemotron-3-ultra-free','mimo-v2.5-free','hy3-free','x-preview-f-free','nemotron-3.5-lightning-free','muse-spark-1.2-contributor-free'],
  opencodego: ['deepseek-v4-flash','deepseek-v4-pro','deepseek-v4-flash-vision-exp','grok-4.5','glm-5.3','glm-5.2','glm-5.1','gpt-5.6-luna','kimi-k3','kimi-k2.7-code','kimi-k2.6','longcat-2.0','mimo-v2.5','mimo-v2.5-pro','minimax-m3','minimax-m2.7','muse-spark-1.2-contributor','qwen3.8-max','qwen3.7-max','qwen3.7-plus','qwen3.6-plus','hy3','ox-alpha-free'],
  openrouter: ['anthropic/claude-sonnet-4-6','openai/gpt-4o','google/gemini-2.5-flash','meta-llama/llama-3.1-70b','mistralai/mistral-large'],
  custom: ['custom-model'],
  ollama: [],
  lmstudio: ['local-model'],
  localai: ['local-model']
};

const TaskClassifier = {
  _rules: [
    {
      task: 'coding',
      patterns: [
        /\b(write|create|implement|fix|debug|refactor|edit|update|change|modify|add|remove|delete)\b.*\b(code|function|class|method|component|file|module|script|bug|error|test)\b/i,
        /\b(code|coding|program|develop|build|compile|deploy|syntax)\b/i,
        /\b(python|javascript|typescript|rust|go|java|c\+\+|ruby|php|swift|kotlin|html|css|sql|bash|shell)\b/i,
        /```[\s\S]*?```/,
        /\b(read_file|write_file|edit_file|list_files|search_files|exec_command)\b/
      ],
      weight: 1.0
    },
    {
      task: 'planning',
      patterns: [
        /\b(plan|planung|architect|design|structure|organize|outline|roadmap|strategy|approach)\b/i,
        /\b(how should|what's the best way|what approach|steps? to|workflow)\b/i,
        /\b(break down|decompose|divide|sequence|order|priority|milestone)\b/i
      ],
      weight: 1.0
    },
    {
      task: 'brainstorming',
      patterns: [
        /\b(brainstorm|ideate|ideas?|suggest|creative|innovative|alternatives?|options?|possibilities)\b/i,
        /\b(what if|could we|maybe we|let's think|imagine|explore)\b/i,
        /\b(pros?\s*(and|&)\s*cons?|trade-?offs?|compare|versus|vs\.?)\b/i
      ],
      weight: 0.9
    },
    {
      task: 'vision',
      patterns: [
        /\b(look at|analyze this image|screenshot|what do you see|describe this picture|ocr|read this text from)\b/i,
        /\.(png|jpg|jpeg|gif|webp|bmp|svg)\b/i,
        /\b(see|visible|display|show in|depicted|illustrated)\b.*\b(image|picture|photo|screenshot|diagram)\b/i
      ],
      weight: 1.0
    },
    {
      task: 'image_generation',
      patterns: [
        /\b(generate|create|draw|make|produce|design)\b.*\b(image|picture|photo|illustration|icon|logo|banner|artwork|graphic)\b/i,
        /\b(dall-?e|midjourney|stable diffusion|image gen|text.to.image)\b/i,
        /\b(design|sketch|mockup|wireframe|ui design)\b/i
      ],
      weight: 1.0
    },
    {
      task: 'tool_calling',
      patterns: [
        /\b(run|execute|execute|install|build|start|stop|restart|deploy)\b.*\b(command|script|server|docker|npm|pip|cargo|brew)\b/i,
        /\b(make_list|make_create|make_update|make_delete|github_|slack_|jira_|notion_)\b/,
        /\b(connect|integrate|api|webhook|service)\b/i
      ],
      weight: 0.8
    },
    {
      task: 'chatting',
      patterns: [
        /.*/
      ],
      weight: 0.3
    }
  ],

  classify(text) {
    if (!text || typeof text !== 'string') return { primary: 'chatting', confidence: 0.3, secondary: null };

    const scores = {};
    for (const rule of this._rules) {
      let matchCount = 0;
      for (const pat of rule.patterns) {
        if (pat.test(text)) matchCount++;
      }
      if (matchCount > 0) {
        scores[rule.task] = (scores[rule.task] || 0) + matchCount * rule.weight;
      }
    }

    if (window._attachedImages && window._attachedImages.length > 0) {
      scores['vision'] = (scores['vision'] || 0) + 5;
    }

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) return { primary: 'chatting', confidence: 0.3, secondary: null };

    const total = sorted.reduce((s, e) => s + e[1], 0);
    const primary = sorted[0][0];
    const confidence = Math.min(sorted[0][1] / total, 1.0);
    const secondary = sorted.length > 1 && sorted[1][1] / total > 0.2 ? sorted[1][0] : null;

    return { primary, confidence, secondary };
  },

  _riskOf(text) {
    const t = (text || '').toLowerCase();
    const hints = ['delete', 'rm ', 'drop ', 'format', 'clear', 'reset', 'password', 'secret', 'credential', 'chmod', 'sudo', 'usb', 'partition', 'bios', 'remove ', 'uninstal', 'löschen', 'formatieren', 'passwort', 'geheim'];
    const hits = hints.filter(h => t.includes(h)).length;
    if (hits >= 3) return 'high';
    if (hits >= 1) return 'medium';
    return 'low';
  },
};

// ==================== TASK ROUTER ====================

const TaskRouter = {
  _enabled: false,
  _mode: 'manual',
  _taskModels: {},
  _taskProviders: {},
  _fallbackQueue: {},
  _disabledTasks: {},

  init() {
    try {
      const saved = JSON.parse(localStorage.getItem('florde-settings') || '{}');
      this._enabled = saved.taskRouterEnabled === true;
      this._mode = saved.taskRouterMode || 'manual';
      this._taskModels = saved.taskRouterModels || {};
      this._taskProviders = saved.taskRouterProviders || {};
      this._fallbackQueue = saved.taskRouterFallbacks || {};
      this._disabledTasks = saved.taskRouterDisabled || {};
    } catch {}
    this._setupDefaults();
    this._setupEvents();
    this._updateChatToolbar();
  },

  _save() {
    try {
      const saved = JSON.parse(localStorage.getItem('florde-settings') || '{}');
      saved.taskRouterEnabled = this._enabled;
      saved.taskRouterMode = this._mode;
      saved.taskRouterModels = this._taskModels;
      saved.taskRouterProviders = this._taskProviders;
      saved.taskRouterFallbacks = this._fallbackQueue;
      saved.taskRouterDisabled = this._disabledTasks;
      localStorage.setItem('florde-settings', JSON.stringify(saved));
    } catch {}
  },

  _setupDefaults() {
    const tasks = ['coding', 'chatting', 'planning', 'brainstorming', 'vision', 'image_generation', 'tool_calling'];
    for (const t of tasks) {
      if (!this._taskModels[t]) {
        this._taskModels[t] = '';
        this._taskProviders[t] = '';
      }
    }
  },

  _setupEvents() {
    document.getElementById('task-router-enabled')?.addEventListener('change', (e) => {
      this._enabled = e.target.checked;
      this._save();
      this._updateChatToolbar();
      this.renderSettings();
    });
    document.getElementById('task-router-mode')?.addEventListener('change', (e) => {
      this._mode = e.target.value;
      this._save();
      this.renderSettings();
      if (this._mode === 'auto') this.autoAssign();
    });
    const settingsBtn = document.getElementById('btn-settings');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        setTimeout(() => this.renderSettings(), 100);
      });
    }
  },

  async renderSettings() {
    const container = document.getElementById('task-router-cards');
    if (!container) return;

    const modeSelect = document.getElementById('task-router-mode');
    if (modeSelect) modeSelect.value = this._mode;

    const enabledToggle = document.getElementById('task-router-enabled');
    if (enabledToggle) enabledToggle.checked = this._enabled;

    const tasks = [
      { id: 'coding', label: 'Coding', icon: '\uD83D\uDCBB' },
      { id: 'chatting', label: 'Chatting', icon: '\uD83D\uDCAC' },
      { id: 'planning', label: 'Planning', icon: '\uD83D\uDCCB' },
      { id: 'brainstorming', label: 'Brainstorming', icon: '\uD83D\uDCA1' },
      { id: 'vision', label: 'Vision', icon: '\uD83D\uDC41' },
      { id: 'image_generation', label: 'Image Gen', icon: '\uD83C\uDFA8' },
      { id: 'tool_calling', label: 'Tool Calling', icon: '\uD83D\uDD27' }
    ];

    const allModels = [];
    const seen = new Set();
    const connectedProviders = this._getConnectedProviders();

    for (const pid of connectedProviders) {
      const catalog = MODEL_CATALOG[pid] || [];
      for (const model of catalog) {
        const key = pid + ':' + model;
        if (seen.has(key)) continue;
        seen.add(key);
        const meta = MODEL_META[model] || {};
        const taskCaps = meta.tasks || MODEL_TASK_DEFAULTS;
        allModels.push({ providerId: pid, model, taskCaps, free: !!meta.free, local: !!meta.local });
      }
    }

    let ollamaModels = [];
    try {
      if (typeof window.electronAPI?.ollamaList === 'function') {
        ollamaModels = await window.electronAPI.ollamaList();
      }
    } catch {}
    for (const m of ollamaModels) {
      const name = typeof m === 'string' ? m : m.name || m.model || '';
      if (!name) continue;
      const key = 'ollama:' + name;
      if (seen.has(key)) continue;
      seen.add(key);
      const meta = MODEL_META[name] || {};
      const taskCaps = meta.tasks || { ...MODEL_TASK_DEFAULTS, experimental_tool_calling: true };
      allModels.push({ providerId: 'ollama', model: name, taskCaps, free: true, local: true });
    }

    allModels.sort((a, b) => {
      if (a.providerId !== b.providerId) return a.providerId.localeCompare(b.providerId);
      return a.model.localeCompare(b.model);
    });

    let html = '';
    for (const task of tasks) {
      const currentModel = this._taskModels[task.id] || '';
      const currentProvider = this._taskProviders[task.id] || '';
      const isDisabled = !!this._disabledTasks[task.id];

      let optionsHtml = '<option value="">-- Select --</option>';
      let lastProvider = '';
      for (const m of allModels) {
        if (m.providerId !== lastProvider) {
          if (lastProvider) optionsHtml += '<option disabled>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</option>';
          optionsHtml += '<option disabled>\u2002' + m.providerId.toUpperCase() + '</option>';
          lastProvider = m.providerId;
        }
        const cap = m.taskCaps[task.id];
        const badge = cap === true ? '\u2705' : cap === false ? '\u274C' : '\u26A0\uFE0F';
        const selected = (m.model === currentModel && m.providerId === currentProvider) ? ' selected' : '';
        optionsHtml += '<option value="' + m.providerId + '::' + m.model + '"' + selected + '>' + badge + ' ' + m.model + '</option>';
      }

      const statusClass = isDisabled ? 'disabled' : (currentModel ? 'active' : '');
      const statusHtml = isDisabled
        ? '<span class="task-card-status disabled">Disabled <button class="btn-link" data-reenable="' + task.id + '" title="Re-enable" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:0.7rem;">&#x21bb;</button></span>'
        : '<span class="task-card-status ' + (currentModel ? 'active' : '') + '">' + (currentModel ? 'Active' : 'None') + '</span>';

      html += '<div class="task-card">' +
        '<span class="task-card-name">' + task.icon + ' ' + task.label + '</span>' +
        '<select class="task-card-select" data-task="' + task.id + '" ' + (this._mode === 'auto' || !this._enabled ? 'disabled' : '') + '>' +
        optionsHtml +
        '</select>' +
        statusHtml +
        '</div>';
    }

    const disabledNotice = this._enabled ? '' : '<div style="font-size:0.75rem;color:var(--text3);padding:0.4rem;text-align:center;">Router is disabled. Enable it above to use task routing.</div>';
    container.innerHTML = html + disabledNotice;

    container.querySelectorAll('.task-card-select').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const task = e.target.dataset.task;
        const val = e.target.value;
        if (val) {
          const [providerId, model] = val.split('::');
          this.setTaskModel(task, providerId, model);
        } else {
          this._taskModels[task] = '';
          this._taskProviders[task] = '';
          this._save();
          this.renderSettings();
        }
      });
    });

    container.querySelectorAll('[data-reenable]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.reEnableTask(btn.dataset.reenable);
      });
    });
  },

  _updateChatToolbar() {
    const providerSelect = document.getElementById('provider-select');
    const aiRouterBtn = document.getElementById('btn-ai-router');
    const freeBadge = document.getElementById('provider-free-badge');
    const modelBadge = document.getElementById('model-info-badge');
    if (this._enabled) {
      if (providerSelect) providerSelect.style.display = 'none';
      if (aiRouterBtn) aiRouterBtn.style.display = 'none';
      if (freeBadge) freeBadge.style.display = 'none';
      if (modelBadge) modelBadge.style.display = 'none';
    } else {
      if (providerSelect) providerSelect.style.display = '';
      if (aiRouterBtn) aiRouterBtn.style.display = '';
      if (freeBadge) freeBadge.style.display = '';
      if (modelBadge) modelBadge.style.display = '';
    }
  },

  _getConnectedProviders() {
    const connected = [];
    const allIds = ['openai','deepseek','mistral','anthropic','gemini','grok','opencodezen','opencodego','ollama','lmstudio','localai','openrouter','custom'];
    for (const pid of allIds) {
      const enabledCb = document.querySelector('.provider-enabled[data-provider="' + pid + '"]');
      if (enabledCb && !enabledCb.checked) continue;
      const keyInput = document.getElementById('key-' + pid);
      const urlInput = document.getElementById('url-' + pid);
      const hasKey = keyInput && keyInput.value.trim() !== '';
      const hasUrl = urlInput && urlInput.value.trim() !== '';
      if (hasKey || hasUrl || providers[pid]) {
        connected.push(pid);
      }
    }
    return connected;
  },

  getModelForTask(taskType, attachedImages) {
    if (this._disabledTasks[taskType]) return null;

    if (attachedImages && attachedImages.length > 0) taskType = 'vision';

    if (this._mode === 'auto') {
      return this._autoSelect(taskType);
    }

    const modelName = this._taskModels[taskType];
    const providerId = this._taskProviders[taskType];
    if (!modelName || !providerId) return null;

    const prov = this._createProvider(providerId, modelName);
    if (!prov) return null;

    return { provider: prov, providerId, model: modelName, taskType };
  },

  _autoSelect(taskType) {
    const candidates = this._getCapableModels(taskType);
    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      const metaA = MODEL_META[a.model] || {};
      const metaB = MODEL_META[b.model] || {};
      if (metaA.free && !metaB.free) return -1;
      if (!metaA.free && metaB.free) return 1;
      return (metaA.costIn || 0) - (metaB.costIn || 0);
    });

    for (const candidate of candidates) {
      const prov = this._createProvider(candidate.providerId, candidate.model);
      if (prov) {
        return { provider: prov, providerId: candidate.providerId, model: candidate.model, taskType };
      }
    }
    return null;
  },

  _getCapableModels(taskType) {
    const candidates = [];
    const seen = new Set();

    if (typeof AIRouter !== 'undefined') {
      for (const route of AIRouter._routes) {
        if (!route.enabled) continue;
        const tasks = MODEL_META[route.model]?.tasks || MODEL_TASK_DEFAULTS;
        if (tasks[taskType]) {
          const key = route.provider + ':' + route.model;
          if (!seen.has(key)) {
            seen.add(key);
            candidates.push({ providerId: route.provider, model: route.model, source: 'route' });
          }
        }
      }
    }

    const allProviderIds = ['openai', 'deepseek', 'mistral', 'anthropic', 'gemini', 'grok', 'opencodezen', 'opencodego', 'openrouter', 'custom', 'ollama', 'lmstudio', 'localai'];
    for (const pid of allProviderIds) {
      if (providers[pid] && providers[pid].model) {
        const tasks = MODEL_META[providers[pid].model]?.tasks || MODEL_TASK_DEFAULTS;
        if (tasks[taskType]) {
          const key = pid + ':' + providers[pid].model;
          if (!seen.has(key)) {
            seen.add(key);
            candidates.push({ providerId: pid, model: providers[pid].model, source: 'provider' });
          }
        }
      }
    }

    return candidates;
  },

  _createProvider(providerId, model) {
    if (typeof AIRouter !== 'undefined') {
      const route = AIRouter._routes.find(r => r.provider === providerId && r.model === model && r.enabled);
      if (route) return AIRouter.getProviderForRoute(route);
    }
    if (providers[providerId]) return providers[providerId];
    return null;
  },

  getFallbackModel(taskType, excludeModel) {
    const candidates = this._getCapableModels(taskType).filter(c => c.model !== excludeModel);
    if (candidates.length === 0) return null;

    const free = candidates.filter(c => MODEL_META[c.model]?.free);
    const pick = free.length > 0 ? free[0] : candidates[0];

    const prov = this._createProvider(pick.providerId, pick.model);
    if (!prov) return null;
    return { provider: prov, providerId: pick.providerId, model: pick.model, taskType };
  },

  handleFailure(taskType, failedModel, error) {
    const isRateLimit = /429|rate.?limit/i.test(error?.message || '');
    const isCapability = /not.?support|cannot|doesn't/i.test(error?.message || '');

    if (isRateLimit) {
      const fallback = this.getFallbackModel(taskType, failedModel);
      if (fallback) {
        return {
          action: 'fallback',
          model: fallback.model,
          providerId: fallback.providerId,
          message: `Rate limited on ${failedModel}. Switching to ${fallback.model}.`
        };
      }
      return {
        action: 'disable',
        message: `Rate limited on ${failedModel} and no fallback available. ${taskType} is temporarily disabled.`
      };
    }

    if (isCapability) {
      const fallback = this.getFallbackModel(taskType, failedModel);
      if (fallback) {
        return {
          action: 'fallback',
          model: fallback.model,
          providerId: fallback.providerId,
          message: `${failedModel} doesn't support ${taskType}. Switching to ${fallback.model}.`
        };
      }
      return {
        action: 'disable',
        message: `${failedModel} doesn't support ${taskType} and no alternative available.`
      };
    }

    return { action: 'error', message: error?.message || 'Unknown error' };
  },

  setTaskModel(taskType, providerId, model) {
    this._taskModels[taskType] = model;
    this._taskProviders[taskType] = providerId;
    this._save();
    this.renderSettings();
  },

  enableTask(taskType) {
    delete this._disabledTasks[taskType];
    this._save();
    this.renderSettings();
  },

  autoAssign() {
    const tasks = ['coding', 'chatting', 'planning', 'brainstorming', 'vision', 'image_generation', 'tool_calling'];
    for (const task of tasks) {
      const best = this._autoSelect(task);
      if (best) {
        this._taskModels[task] = best.model;
        this._taskProviders[task] = best.providerId;
      }
    }
    this._save();
    this.renderSettings();
  },

  renderTaskIndicator(classification) {
    if (!this._enabled) {
      const old = document.getElementById('task-indicator');
      if (old) old.style.display = 'none';
      return;
    }
    let indicator = document.getElementById('task-indicator');
    if (!indicator) {
      indicator = document.createElement('span');
      indicator.id = 'task-indicator';
      indicator.className = 'task-indicator';
      const toolbar = document.querySelector('.chat-panel .panel-header');
      if (toolbar) toolbar.appendChild(indicator);
    }
    if (classification) {
      const labels = { coding: 'Coding', chatting: 'Chat', planning: 'Planning', brainstorming: 'Ideas', vision: 'Vision', image_generation: 'Image Gen', tool_calling: 'Tools' };
      indicator.textContent = labels[classification.primary] || classification.primary;
      indicator.title = 'Router: ' + classification.primary + ' (' + Math.round(classification.confidence * 100) + '%)';
      indicator.style.display = '';
    } else {
      indicator.style.display = 'none';
    }
  },

  showFallbackToast(message, onSwitch, onDisable) {
    document.querySelectorAll('.task-fallback-toast').forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = 'task-fallback-toast';
    toast.innerHTML = `<span>${message}</span>
      <div style="display:flex;gap:0.4rem;">
        ${onSwitch ? '<button class="btn btn-primary btn-sm" id="fallback-switch">Switch</button>' : ''}
        ${onDisable ? '<button class="btn btn-secondary btn-sm" id="fallback-disable">Disable</button>' : ''}
        <button class="btn btn-secondary btn-sm" id="fallback-dismiss">Dismiss</button>
      </div>`;
    document.body.appendChild(toast);

    toast.querySelector('#fallback-switch')?.addEventListener('click', () => { toast.remove(); onSwitch?.(); });
    toast.querySelector('#fallback-disable')?.addEventListener('click', () => { toast.remove(); onDisable?.(); });
    toast.querySelector('#fallback-dismiss')?.addEventListener('click', () => toast.remove());

    setTimeout(() => toast.remove(), 15000);
  },

  reEnableTask(taskType) {
    delete this._disabledTasks[taskType];
    this._save();
    this.renderSettings();
  },

  resetAll() {
    this._taskModels = {};
    this._taskProviders = {};
    this._disabledTasks = {};
    this._mode = 'manual';
    this._enabled = false;
    this._save();
    this._updateChatToolbar();
    this.renderSettings();
    const modeSelect = document.getElementById('task-router-mode');
    if (modeSelect) modeSelect.value = 'manual';
    const enabledToggle = document.getElementById('task-router-enabled');
    if (enabledToggle) enabledToggle.checked = false;
  }
};

// ==================== LOOP DETECTION UI ====================

function updateLoopIndicator(status, analysis) {
  let indicator = document.getElementById('loop-indicator');
  if (!indicator) {
    indicator = document.createElement('span');
    indicator.id = 'loop-indicator';
    indicator.style.cssText = 'font-size:0.7rem;padding:2px 6px;border-radius:3px;margin-left:0.4rem;cursor:pointer;';
    const toolbar = document.querySelector('.chat-panel .panel-header');
    if (toolbar) toolbar.appendChild(indicator);
  }
  const labels = { possible: '\u26a0\ufe0f Possible loop', confirmed: '\ud83d\udfe0 Loop detected', critical: '\ud83d\udd34 Critical loop' };
  const colors = { possible: '#eab308', confirmed: '#f97316', critical: '#ef4444' };
  indicator.textContent = labels[status] || '';
  indicator.style.background = colors[status] || 'transparent';
  indicator.style.color = '#fff';
  indicator.style.display = status === 'normal' ? 'none' : '';
  if (analysis) {
    indicator.title = `Score: ${(analysis.score * 100).toFixed(0)}% | Type: ${analysis.type || 'unknown'}`;
  }
}

async function handleLoopDetection(analysis) {
  if (analysis.status === 'possible') {
    updateLoopIndicator('possible', analysis);
    chatHistory.push({ role: 'system', content: `[Loop] Possible ${analysis.type || 'loop'} \u2014 Score: ${(analysis.score * 100).toFixed(0)}%` });
    return false;
  }

  if (analysis.status === 'critical') {
    updateLoopIndicator('critical', analysis);
    const recoveryStatus = recoveryManager.getStatus();
    if (recoveryStatus.attempts >= recoveryStatus.maxAttempts) {
      chatHistory.push({ role: 'system', content: `[Loop] Critical Loop \u2014 Agent stopped after ${recoveryStatus.maxAttempts} failed recovery attempts. Score: ${(analysis.score * 100).toFixed(0)}%` });
      appendSubagentStatus('main', '\ud83d\udd34 Critical Loop: Agent stopped after ' + recoveryStatus.maxAttempts + ' failed recovery attempts.');
      return true;
    }
  }

  updateLoopIndicator(analysis.status, analysis);

  return new Promise((resolve) => {
    const existing = document.getElementById('loop-warning-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'loop-warning-modal';
    modal.className = 'modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:10000;';

    const recoveryStatus = recoveryManager.getStatus();
    const typeLabels = { exact_loop: 'Exact Loop', error_loop: 'Error Loop', revert_loop: 'Revert Loop', context_loop: 'Context Loop' };
    const typeLabel = typeLabels[analysis.type] || 'Loop';

    modal.innerHTML = `
      <div style="background:var(--bg1);border:1px solid var(--border);border-radius:12px;padding:1.5rem;max-width:420px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.4);">
        <div style="font-size:1.1rem;font-weight:600;margin-bottom:0.8rem;color:var(--danger);">\u26a0\ufe0f Loop detected</div>
        <div style="font-size:0.85rem;color:var(--text2);margin-bottom:1rem;">
          Florde detected that the agent has made little or no measurable progress.
        </div>
        <div style="font-size:0.8rem;color:var(--text);margin-bottom:0.5rem;">
          <strong>Type:</strong> ${typeLabel}<br>
          <strong>Score:</strong> ${(analysis.score * 100).toFixed(0)}%<br>
          <strong>Recovery:</strong> ${recoveryStatus.attempts} / ${recoveryStatus.maxAttempts}<br>
          <strong>Agent:</strong> main<br>
        </div>
        <div style="display:flex;gap:0.5rem;margin-top:1rem;">
          <button id="loop-pause-btn" class="btn btn-secondary" style="flex:1;">Pause Agent</button>
          <button id="loop-retry-btn" class="btn btn-primary" style="flex:1;">Retry</button>
          <button id="loop-continue-btn" class="btn btn-secondary" style="flex:1;">Continue</button>
        </div>
      </div>`;

    document.body.appendChild(modal);

    modal.querySelector('#loop-pause-btn').addEventListener('click', () => {
      modal.remove();
      resolve(true);
    });

    modal.querySelector('#loop-retry-btn').addEventListener('click', () => {
      modal.remove();
      // Persist loop event to chat history
      const loopTimestamp = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      const typeLabels = { exact_loop: 'Exact Loop', error_loop: 'Error Loop', revert_loop: 'Revert Loop', context_loop: 'Context Loop' };
      chatHistory.push({ role: 'system', content: `[Loop] ${loopTimestamp} ${analysis.status} \u2014 ${typeLabels[analysis.type] || analysis.type} \u2014 Score: ${(analysis.score * 100).toFixed(0)}%` });

      const recovery = recoveryManager.attemptRecovery(analysis, loopDetector);
      if (recovery.critical) {
        appendSubagentStatus('main', '\ud83d\udd34 Critical Loop: Max recovery attempts reached.');
        resolve(true);
      } else {
        appendSubagentStatus('main', '\ud83d\udfe1 Recovery attempt ' + recovery.attempt + '/' + recovery.maxAttempts + ': ' + recovery.prompt.slice(0, 80) + '...');
        // Mark recovery as potentially successful in history (will be confirmed by progress check)
        const lastRecovery = recoveryManager._recoveryHistory[recoveryManager._recoveryHistory.length - 1];
        if (lastRecovery) {
          // Schedule a progress check after a few tool rounds
          setTimeout(() => {
            const currentMetrics = { ...loopDetector._metrics };
            const lastError = currentMetrics.errorFingerprint;
            if (lastError !== analysis.details?.signals?.sameError) {
              lastRecovery.successful = true;
              recoveryManager._save();
              recoveryManager.resetCounter();
              updateLoopIndicator('normal', null);
            }
          }, 30000); // Check after 30 seconds
        }
        resolve(false);
      }
    });

    modal.querySelector('#loop-continue-btn').addEventListener('click', () => {
      modal.remove();
      resolve(false);
    });
  });
}

// Loop Detection settings events
document.getElementById('loop-detection-enabled')?.addEventListener('change', (e) => {
  const s = JSON.parse(localStorage.getItem('florde-settings') || '{}');
  s.loopDetection = { ...(s.loopDetection || {}), enabled: e.target.checked };
  localStorage.setItem('florde-settings', JSON.stringify(s));
});
document.getElementById('loop-detection-sensitivity')?.addEventListener('change', (e) => {
  const s = JSON.parse(localStorage.getItem('florde-settings') || '{}');
  s.loopDetection = { ...(s.loopDetection || {}), sensitivity: e.target.value };
  localStorage.setItem('florde-settings', JSON.stringify(s));
  if (typeof loopDetector !== 'undefined') loopDetector._sensitivity = e.target.value;
});
document.getElementById('loop-detection-auto-recovery')?.addEventListener('change', (e) => {
  const s = JSON.parse(localStorage.getItem('florde-settings') || '{}');
  s.loopDetection = { ...(s.loopDetection || {}), autoRecovery: e.target.checked };
  localStorage.setItem('florde-settings', JSON.stringify(s));
  if (typeof recoveryManager !== 'undefined') recoveryManager.configure({ autoRecovery: e.target.checked });
});
document.getElementById('loop-detection-recovery-delay')?.addEventListener('change', (e) => {
  const s = JSON.parse(localStorage.getItem('florde-settings') || '{}');
  s.loopDetection = { ...(s.loopDetection || {}), recoveryDelay: parseInt(e.target.value) };
  localStorage.setItem('florde-settings', JSON.stringify(s));
  if (typeof recoveryManager !== 'undefined') recoveryManager.configure({ recoveryDelay: parseInt(e.target.value) });
});
document.getElementById('loop-detection-max-attempts')?.addEventListener('change', (e) => {
  const s = JSON.parse(localStorage.getItem('florde-settings') || '{}');
  s.loopDetection = { ...(s.loopDetection || {}), maxAttempts: parseInt(e.target.value) };
  localStorage.setItem('florde-settings', JSON.stringify(s));
  if (typeof recoveryManager !== 'undefined') recoveryManager.configure({ maxAttempts: parseInt(e.target.value) });
});
document.getElementById('loop-detection-stop-critical')?.addEventListener('change', (e) => {
  const s = JSON.parse(localStorage.getItem('florde-settings') || '{}');
  s.loopDetection = { ...(s.loopDetection || {}), stopOnCritical: e.target.checked };
  localStorage.setItem('florde-settings', JSON.stringify(s));
});

// ==================== SETTINGS ====================

async function maybeShowSandboxWizard() {
  try {
    const cfg = await window.electronAPI.sandbox.getConfig();
    if (!cfg.configured) {
      await SandboxWizard.open();
    }
  } catch {}
}

async function loadSettings() {
  try {
  const s = await window.electronAPI.getSettings();
  if (!s) return;

  function setToggle(id) {
    const cb = document.querySelector('.provider-enabled[data-provider="' + id + '"]');
    if (cb) cb.checked = s[id + 'Enabled'] === true;
  }
    const allProviderIds = ['openai','deepseek','mistral','anthropic','gemini','grok','opencodezen','opencodego','ollama','lmstudio','localai','openrouter','custom'];
  for (const id of allProviderIds) setToggle(id);

  delete providers.openai; delete providers.deepseek; delete providers.mistral;
  delete providers.anthropic; delete providers.gemini; delete providers.grok;
  delete providers.opencodezen; delete providers.opencodego; delete providers.ollama; delete providers.lmstudio; delete providers.localai;
  delete providers.openrouter; delete providers.custom;

  const providerCtors = {
    openai: [OpenAIProvider, 'key', 'model', 'gpt-5.5'],
    deepseek: [DeepSeekProvider, 'key', 'model', 'deepseek-chat'],
    mistral: [MistralProvider, 'key', 'model', 'mistral-large-latest'],
    anthropic: [AnthropicProvider, 'key', 'model', 'claude-sonnet-4-6'],
    gemini: [GeminiProvider, 'key', 'model', 'gemini-2.5-flash'],
    grok: [GrokProvider, 'key', 'model', 'grok-4.3'],
    opencodezen: [OpenCodeProvider, 'key', 'model', 'big-pickle'],
    opencodego: [OpenCodeGoProvider, 'key', 'model', 'deepseek-v4-flash'],
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
  if (s.opencodezenModel) document.getElementById('model-opencodezen').value = s.opencodezenModel;
  if (s.opencodegoModel) document.getElementById('model-opencodego').value = s.opencodegoModel;
  if (s.language) document.getElementById('settings-language').value = s.language;
  // Add model info buttons + free/key badges in settings
  document.querySelectorAll('.provider-body [id^="model-"]').forEach(sel => {
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
    setToggle('auto-start', autoStart);
  } catch {}
  if (s.offlineMode) {
    setToggle('offline-mode', true);
    enableOfflineMode(true);
  }
  if (s.seeThoughts !== undefined) setToggle('see-thoughts', s.seeThoughts);
  else setToggle('see-thoughts', true);
  if (s.instantMode !== undefined) setToggle('instant-mode', s.instantMode);
  else setToggle('instant-mode', false);
  if (s.detailedActivity !== undefined) setToggle('detailed-activity', s.detailedActivity);
  else setToggle('detailed-activity', false);
  if (s.theme) { currentTheme = s.theme; document.getElementById('settings-theme').value = s.theme; applyTheme(); }
  if (s.layout) {
    document.body.className = document.body.className.replace(/layout-\S+/g, '').trim();
    document.body.classList.add('layout-' + s.layout);
    const radio = document.querySelector('.layout-option input[value="' + s.layout + '"]');
    if (radio) radio.checked = true;
  }
  if (s.shortcuts) {
    // Migration alter Shortcuts zu KeybindManager
    if (typeof KeybindManager !== 'undefined') {
      for (const [id, sc] of Object.entries(s.shortcuts)) {
        KeybindManager.setBinding(id, sc.keys);
      }
    }
  }
  // Add temperature sliders to each provider body
  const tempProviders = ['openai','deepseek','mistral','anthropic','gemini','grok','opencodezen','opencodego','ollama','lmstudio','localai','openrouter','custom'];
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
  await autoFillAllKeys();
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
    setToggle('auto-accept', s.autoAccept);
    document.getElementById('auto-exceptions-area').classList.toggle('hidden', !s.autoAccept);
    if (s.autoAccept) {
      const permList = document.getElementById('permission-list');
      if (permList) { permList.style.opacity = '0.4'; permList.style.pointerEvents = 'none'; }
    }
  }
  const ex = s.autoExceptions || {};
  const excKeys = ['shell', 'outside', 'git', 'terminal', 'write_file', 'delete_file', 'web_search', 'web_fetch', 'browser', 'ask_question'];
  for (const key of excKeys) {
    const el = document.getElementById('exc-' + key);
    if (el) el.checked = ex[key] || false;
  }
  const ci = document.getElementById('custom-instructions');
  if (ci && s.customInstructions !== undefined) ci.value = s.customInstructions;
  // Restore agent mode preference
  const savedMode = localStorage.getItem('florde-agent-mode');
  if (savedMode === 'build') {
    const btn = document.getElementById('btn-agentic-mode');
    if (btn) {
      btn.classList.remove('agentic-plan');
      btn.classList.add('agentic-build');
      btn.textContent = 'Build';
      btn.title = 'Build mode: AI executes directly';
    }
  }
  // Load loop detection settings
  try {
    const ldSettings = s.loopDetection || {};
    const setCb = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };
    const setSel = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    setCb('loop-detection-enabled', ldSettings.enabled !== false);
    setSel('loop-detection-sensitivity', ldSettings.sensitivity || 'balanced');
    setCb('loop-detection-auto-recovery', ldSettings.autoRecovery !== false);
    setSel('loop-detection-recovery-delay', String(ldSettings.recoveryDelay || 120000));
    setSel('loop-detection-max-attempts', String(ldSettings.maxAttempts || 3));
    setCb('loop-detection-stop-critical', ldSettings.stopOnCritical !== false);
  } catch {}
  maybeShowSandboxWizard();
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
    { id: 'opencodezen', key: document.getElementById('key-opencodezen').value, model: document.getElementById('model-opencodezen').value, test: async () => (new OpenCodeProvider(document.getElementById('key-opencodezen').value, document.getElementById('model-opencodezen').value)).testKey() },
    { id: 'opencodego', key: document.getElementById('key-opencodego').value, model: document.getElementById('model-opencodego').value, test: async () => (new OpenCodeGoProvider(document.getElementById('key-opencodego').value, document.getElementById('model-opencodego').value)).testKey() },
    { id: 'openrouter', key: document.getElementById('key-openrouter').value, model: document.getElementById('model-openrouter').value, test: async () => (new OpenRouterProvider(document.getElementById('key-openrouter').value, document.getElementById('model-openrouter').value)).testKey() },
    { id: 'custom', key: document.getElementById('key-custom').value, model: document.getElementById('model-custom').value, test: async () => (new CustomProvider(document.getElementById('key-custom').value, document.getElementById('model-custom').value, document.getElementById('url-custom').value)).testKey() },
    { id: 'ollama', key: '', model: document.getElementById('model-ollama')?.value || '', test: async () => true },
    { id: 'lmstudio', key: '', model: document.getElementById('model-lmstudio')?.value || '', test: async () => true },
    { id: 'localai', key: '', model: document.getElementById('model-localai')?.value || '', test: async () => true },
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

  const providerIds = ['openai','deepseek','mistral','anthropic','gemini','grok','opencodezen','opencodego','ollama','lmstudio','localai','openrouter','custom'];
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
  settings.layout = document.querySelector('.layout-option input:checked')?.value || 'sidebar-left';
  settings.language = document.getElementById('settings-language').value;
  settings.offlineMode = getToggle('offline-mode');
  settings.seeThoughts = getToggle('see-thoughts');
  settings.instantMode = getToggle('instant-mode');
  settings.detailedActivity = getToggle('detailed-activity');

  localStorage.setItem('florde-capability-cache', JSON.stringify(capabilityCache));
  await saveSettingsToDisk(settings);

  // Apply language immediately
  if (typeof I18n !== 'undefined') {
    I18n._currentLang = settings.language || 'en';
    await I18n.applyToPage();
  }

  // Save valid API keys to OS keychain
  if (window.electronAPI?.keychain) {
    const keyProviders = [
      { id: 'openai', key: settings.openaiKey },
      { id: 'deepseek', key: settings.deepseekKey },
      { id: 'mistral', key: settings.mistralKey },
      { id: 'anthropic', key: settings.anthropicKey },
      { id: 'gemini', key: settings.geminiKey },
      { id: 'grok', key: settings.grokKey },
      { id: 'opencodezen', key: settings.opencodezenKey },
      { id: 'opencodego', key: settings.opencodegoKey },
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
  delete providers.opencodezen; delete providers.opencodego; delete providers.ollama; delete providers.lmstudio; delete providers.localai;
  delete providers.openrouter; delete providers.custom;

  function setTemp(prov, id) { if (prov) prov.temperature = settings[id + 'Temp'] || 0.7; }
  const p = settings;
  if (p.openaiEnabled && p.openaiKey) setTemp(providers.openai = new OpenAIProvider(p.openaiKey, p.openaiModel), 'openai');
  if (p.deepseekEnabled && p.deepseekKey) setTemp(providers.deepseek = new DeepSeekProvider(p.deepseekKey, p.deepseekModel), 'deepseek');
  if (p.mistralEnabled && p.mistralKey) setTemp(providers.mistral = new MistralProvider(p.mistralKey, p.mistralModel), 'mistral');
  if (p.anthropicEnabled && p.anthropicKey) setTemp(providers.anthropic = new AnthropicProvider(p.anthropicKey, p.anthropicModel), 'anthropic');
  if (p.geminiEnabled && p.geminiKey) setTemp(providers.gemini = new GeminiProvider(p.geminiKey, p.geminiModel), 'gemini');
  if (p.grokEnabled && p.grokKey) setTemp(providers.grok = new GrokProvider(p.grokKey, p.grokModel), 'grok');
  if (p.opencodezenEnabled && p.opencodezenKey) setTemp(providers.opencodezen = new OpenCodeProvider(p.opencodezenKey, p.opencodezenModel), 'opencodezen');
  if (p.opencodegoEnabled && p.opencodegoKey) setTemp(providers.opencodego = new OpenCodeGoProvider(p.opencodegoKey, p.opencodegoModel), 'opencodego');
  if (p.ollamaEnabled) setTemp(providers.ollama = new OllamaProvider(p.ollamaUrl, p.ollamaModel), 'ollama');
  if (p.lmstudioEnabled) setTemp(providers.lmstudio = new LMStudioProvider(p.lmstudioUrl, p.lmstudioModel), 'lmstudio');
  if (p.localaiEnabled) setTemp(providers.localai = new LocalAIProvider(p.localaiUrl, p.localaiModel), 'localai');
  if (p.openrouterEnabled && p.openrouterKey) setTemp(providers.openrouter = new OpenRouterProvider(p.openrouterKey, p.openrouterModel), 'openrouter');
  if (p.customEnabled && p.customKey) setTemp(providers.custom = new CustomProvider(p.customKey, p.customModel, p.customUrl), 'custom');

  const prevTheme = currentTheme;
  currentTheme = settings.theme;
  if (currentTheme !== prevTheme) applyTheme();

  await window.electronAPI.setAutoStart(getToggle('auto-start'));

  enableOfflineMode(settings.offlineMode);

  updateProviderDropdown();

  saveBtn.disabled = false;
  saveBtn.textContent = 'Save';

  if (invalidResults.length === 0) {
    hideModal('settings-modal');
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

// ==================== OFFLINE MODE ====================

let _offlineMode = false;
let _originalFetch = null;
let _originalXHROpen = null;

function enableOfflineMode(enabled) {
  _offlineMode = enabled;
  if (enabled) {
    if (!_originalFetch) _originalFetch = window.fetch;
    window.fetch = function(input, init) {
      const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');
      const allowed = url.startsWith('file://') || url.startsWith('data:') || url.startsWith('blob:') || url.includes('localhost') || url.includes('127.0.0.1') || url.includes('::1');
      if (allowed) return _originalFetch.call(window, input, init);
      logToTerminal('Blocked fetch (offline mode): ' + url.slice(0, 120), 'warn');
      return Promise.reject(new Error('Offline mode: internet access blocked'));
    };
    if (!_originalXHROpen) _originalXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      const urlStr = typeof url === 'string' ? url : (url ? url.toString() : '');
      const allowed = urlStr.startsWith('file://') || urlStr.startsWith('data:') || urlStr.startsWith('blob:') || urlStr.includes('localhost') || urlStr.includes('127.0.0.1') || urlStr.includes('::1');
      if (!allowed) {
        logToTerminal('Blocked XHR (offline mode): ' + urlStr.slice(0, 120), 'warn');
        throw new Error('Offline mode: internet access blocked');
      }
      return _originalXHROpen.call(this, method, url, ...rest);
    };
  } else {
    if (_originalFetch) { window.fetch = _originalFetch; _originalFetch = null; }
    if (_originalXHROpen) { XMLHttpRequest.prototype.open = _originalXHROpen; _originalXHROpen = null; }
  }
}

// ==================== THEME ====================

function applyTheme() {
  document.documentElement.setAttribute('data-theme', currentTheme || 'dark');
  const isLight = currentTheme === 'light' || currentTheme === 'solarized-light';
  document.getElementById('btn-theme-toggle') && (document.getElementById('btn-theme-toggle').textContent = isLight ? '\u263D' : '\u2600');
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
  let isLocal = selected === 'ollama' || selected === 'lmstudio' || selected === 'localai';
  if (selected.startsWith('route:')) {
    const route = AIRouter._routes.find(r => r.id === selected.slice(6));
    isLocal = route && ['ollama','lmstudio','localai'].includes(route.provider);
  }
  if (isLocal) {
    el.textContent = '\uD83D\uDFE2 Local';
    el.className = 'privacy-indicator local';
    el.title = '100% Local - no data leaves this PC.';
  } else {
    el.textContent = '\uD83D\uDFE1 Hybrid';
    el.className = 'privacy-indicator hybrid';
    el.title = 'External provider - data is encrypted in transit.';
  }
}

function updateProviderDropdown() {
  AIRouter.renderDropdown();
  updatePrivacyIndicator();
  updateModelInfoBadge();
  if (typeof TaskRouter !== 'undefined' && TaskRouter._enabled) {
    TaskRouter._updateChatToolbar();
  }
}

function updateModelInfoBadge() {
  const badge = document.getElementById('model-info-badge');
  if (!badge) return;
  const sel = document.getElementById('provider-select');
  const selected = sel?.value;
  let providerId, model;
  if (selected?.startsWith('route:')) {
    const route = AIRouter._routes.find(r => r.id === selected.slice(6));
    providerId = route?.provider || 'openai';
    model = route?.model || '';
  } else {
    providerId = selected;
    model = providers[providerId]?.model || '';
  }
  badge.textContent = model;
  badge.title = 'Model: ' + model + '\nProvider: ' + (providerId || '') + '\nClick for details';
  const freeBadge = document.getElementById('provider-free-badge');
  if (freeBadge) {
    const meta = MODEL_META[model];
    const isLocal = providerId === 'ollama' || providerId === 'lmstudio' || providerId === 'localai';
    const isFree = meta ? meta.free : isLocal;
    freeBadge.textContent = isFree ? '\u2601 Free' : '\uD83D\uDD11 Key';
    freeBadge.className = 'model-free-badge ' + (isFree ? 'free' : 'key');
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
  document.querySelectorAll('.modal-overlay:not(#command-palette-overlay)').forEach(el => el.remove());
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
  const selected = sel?.value;
  let providerId, prov, modelName;
  if (selected?.startsWith('route:')) {
    const route = AIRouter._routes.find(r => r.id === selected.slice(6));
    providerId = route?.provider || 'openai';
    prov = AIRouter.getProviderForRoute(route);
    modelName = route?.model || 'Unknown';
  } else {
    providerId = selected;
    prov = providers[providerId];
    modelName = prov?.model || 'Unknown';
  }
  const cacheKey = providerId + ':' + modelName;
  const caps = capabilityCache[cacheKey] || getKnownCapabilities(providerId, modelName);
  const temp = prov?.temperature !== undefined ? prov.temperature : 0.7;
  const isLocal = providerId === 'ollama' || providerId === 'lmstudio' || providerId === 'localai';
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
  if (!el) return;
  if (currentProjectType === 'local') {
    el.textContent = '';
    el.className = 'sandbox-status hidden';
    return;
  }
  if (sandboxDir) {
    el.textContent = 'Sandbox: ' + sandboxDir;
    el.className = 'sandbox-status active';
  } else {
    el.textContent = 'No sandbox configured';
    el.className = 'sandbox-status inactive';
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

// Bridge: core/logger-Events ins Terminal rendern (bis Phase C UI-Schicht)
if (window.__coreEvents && window.__coreEvents.on) {
  window.__coreEvents.on('state:log', (e) => {
    if (e && e.message) logToTerminal(e.message, e.type || 'info');
  });
}

// ==================== START MENU ====================

function blurMonaco() {
  const container = document.getElementById('editor-container');
  if (!container) return;
  const ta = container.querySelector('textarea');
  if (ta) { ta.blur(); ta.setAttribute('tabindex', '-1'); }
}

// Debug: log which elements exist and their pointer-events state
['btn-create-project','btn-cancel-new','btn-create-local','btn-cancel-local','new-project-modal','local-project-modal'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    const cs = getComputedStyle(el);
    console.log(`DEBUG ${id}:`, {pointerEvents: cs.pointerEvents, zIndex: cs.zIndex, display: cs.display, cursor: cs.cursor, webkitAppRegion: cs.webkitAppRegion || cs.getPropertyValue('-webkit-app-region')});
  } else console.warn(`DEBUG: #${id} NOT FOUND`);
});

// Debug: highlight click target on document
// Removed debug logging
// Debug: show hover target info
document.addEventListener('mouseover', (e) => {
  const el = e.target;
  if (el.id && (el.id.includes('btn') || el.id.includes('modal'))) {
    const cs = getComputedStyle(el);
    console.log('HOVER on', el.id, {cursor: cs.cursor, pe: cs.pointerEvents, display: cs.display, region: cs.getPropertyValue('-webkit-app-region')});
  }
}, true);

function showStartMenu() {
  document.getElementById('start-menu').classList.remove('hidden');
  document.getElementById('app-view').classList.add('hidden');
  loadProjectList();
}

function showAppView() {
  document.getElementById('start-menu').classList.add('hidden');
  document.getElementById('app-view').classList.remove('hidden');
  restoreMonacoTabindex();
  initLayoutManager();
}

function initLayoutManager() {
  if (typeof LayoutManager === 'undefined') return;
  const container = document.getElementById('layout-container');
  if (!container) return;
  if (LayoutManager.isInitialized) return;
  LayoutManager.init(container).then(() => {
    if (LayoutManager.isInitialized) {
      LayoutManager.activate();
      if (typeof EditorMode !== 'undefined') applyModeToLayout(EditorMode.getMode());
    }
  });
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
  const list = document.getElementById('project-list');
  const container = document.getElementById('project-items');
  document.getElementById('start-dashboard').classList.add('hidden');
  document.getElementById('start-main-title').textContent = 'Recent Projects';
  document.getElementById('start-main-subtitle').textContent = 'Continue where you left off';
  if (!window.electronAPI) { container.innerHTML = '<div style="color:var(--text3);font-size:0.85rem;padding:0.5rem;">App not ready</div>'; return; }
  const projects = getSortedProjects(await window.electronAPI.listProjects());
  container.innerHTML = '';
  list.classList.remove('hidden');
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
    div.innerHTML = `<button class="star-icon" data-path="${escapeHtml(p.name)}">${isFav ? '\u2605' : '\u2606'}</button><span class="project-type">${typeLabel}</span><span style="flex:1">${escapeHtml(p.name)}</span><button class="project-del" data-name="${escapeHtml(p.name)}">&times;</button>`;
    div.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') {
        WorkspaceManager.openProject(p.name, p.name).catch(err => console.error('openProject failed:', err));
      }
    });
    div.querySelector('.star-icon').addEventListener('click', (e) => {
      e.stopPropagation();
      Favorites.toggle(p.name);
    });
    div.querySelector('.project-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete project "${p.name}"?`)) return;
      try {
        const result = await window.electronAPI.deleteProject(p.name);
        if (!result.ok) throw new Error(result.error || 'unknown');
        if (result.flordePath) {
          if (confirm(`".florde/" folder found at:\n${result.flordePath}\n\nDelete it too?`)) {
            await window.electronAPI.flordeDir.remove(p.name).catch(() => {});
          }
        }
        loadProjectList();
      } catch (err) {
        showNotification('error', 'Delete failed: ' + err.message);
      }
    });
    container.appendChild(div);
  }
}

function showModal(modalId) {
  const el = document.getElementById(modalId);
  if (!el) return;
  el.classList.remove('hidden');
}
function hideModal(modalId) {
  const el = document.getElementById(modalId);
  if (!el) return;
  el.classList.add('hidden');
}
function hideAllModals() {
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

function showFlordeConfirmDialog(projectName, { exists, lsKeys }) {
  return new Promise(resolve => {
    const modal = document.getElementById('florde-confirm-modal');
    const text = document.getElementById('florde-confirm-text');
    const btns = document.getElementById('florde-confirm-buttons');
    btns.innerHTML = '';
    modal.classList.remove('hidden');

    const close = result => {
      modal.classList.add('hidden');
      resolve(result);
    };

    if (exists) {
      text.textContent = `".florde/" exists for "${projectName}". What do you want to do?` +
        (lsKeys.length > 0 ? ` (${lsKeys.length} localStorage entries found)` : '');
      addButton('Migrate localStorage', 'migrate', 'btn btn-primary', () => close('migrate'), btns);
      addButton('Delete .florde', 'delete', 'btn danger', () => close('delete'), btns);
      addButton('Cancel', 'cancel', 'btn btn-secondary', () => close(null), btns);
    } else {
      if (lsKeys.length > 0) {
        text.textContent = `".florde/" not found for "${projectName}". ${lsKeys.length} localStorage entries found — create and migrate, or create fresh?`;
        addButton('Create & Migrate', 'create_migrate', 'btn btn-primary', () => close('create_migrate'), btns);
        addButton('Create Fresh', 'create', 'btn btn-primary', () => close('create'), btns);
        addButton('Skip', 'skip', 'btn btn-secondary', () => close(null), btns);
      } else {
        text.textContent = `".florde/" not found for "${projectName}". Create it? (AI memory, todos, notes, decisions in SQLite)`;
        addButton('Create', 'create', 'btn btn-primary', () => close('create'), btns);
        addButton('Skip', 'skip', 'btn btn-secondary', () => close(null), btns);
      }
    }

    modal.addEventListener('click', function onOverlay(e) {
      if (e.target === modal) { modal.removeEventListener('click', onOverlay); close(null); }
    });
  });
}

function addButton(label, value, className, onClick, container) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.className = className;
  btn.addEventListener('click', onClick);
  container.appendChild(btn);
}

function showPromptDialog(title, text, placeholder, defaultValue) {
  return new Promise(resolve => {
    document.getElementById('prompt-title').textContent = title;
    document.getElementById('prompt-text').textContent = text;
    const input = document.getElementById('prompt-input');
    input.value = defaultValue || '';
    input.placeholder = placeholder || '...';
    input.focus();
    input.select();
    showModal('prompt-modal');
    function cleanup() {
      hideModal('prompt-modal');
      document.getElementById('btn-prompt-ok').removeEventListener('click', onOk);
      document.getElementById('btn-prompt-cancel').removeEventListener('click', onCancel);
    }
    function onOk() { cleanup(); resolve(input.value); }
    function onCancel() { cleanup(); resolve(null); }
    document.getElementById('btn-prompt-ok').addEventListener('click', onOk);
    document.getElementById('btn-prompt-cancel').addEventListener('click', onCancel);
  });
}

document.getElementById('btn-start-new')?.addEventListener('click', () => {
  hideAllModals();
  showModal('new-project-modal');
  const npn = document.getElementById('new-project-name');
  if (npn) { npn.value = ''; requestAnimationFrame(() => npn.focus()); }
  blurMonaco();
});

document.getElementById('new-project-modal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) hideModal('new-project-modal');
});

document.getElementById('btn-cancel-new')?.addEventListener('click', () => {
  hideModal('new-project-modal');
});

function createProjectFromInput() {
  const name = document.getElementById('new-project-name').value.trim();
  if (!name) { alert('Please enter a project name'); return; }
  if (!window.electronAPI) { alert('App not ready: electronAPI not available'); return; }
  window.electronAPI.createSandboxProject(name).then(ok => {
    if (ok) {
      hideModal('new-project-modal');
      WorkspaceManager.openProject(name, name);
    } else {
      alert('Project already exists');
    }
  }).catch(err => {
    alert('Failed to create project: ' + err.message);
  });
}

const btnCreate = document.getElementById('btn-create-project');
if (btnCreate) {
  btnCreate.addEventListener('click', (e) => {
    console.log('Create clicked');
    createProjectFromInput();
  });
} else console.error('btn-create-project not found');

const btnCancelNew = document.getElementById('btn-cancel-new');
if (btnCancelNew) {
  btnCancelNew.addEventListener('click', (e) => {
    console.log('Cancel clicked');
    hideModal('new-project-modal');
  });
} else console.error('btn-cancel-new not found');
document.getElementById('new-project-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') createProjectFromInput();
});

// Local Project
document.getElementById('btn-start-local').addEventListener('click', () => {
  hideAllModals();
  showModal('local-project-modal');
  document.getElementById('local-project-name').value = '';
  document.getElementById('local-project-path').value = '';
  blurMonaco();
  requestAnimationFrame(() => document.getElementById('local-project-name').focus());
});

document.getElementById('local-project-modal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) hideModal('local-project-modal');
});

const btnCancelLocal = document.getElementById('btn-cancel-local');
if (btnCancelLocal) {
  btnCancelLocal.addEventListener('click', () => {
    console.log('Local cancel clicked');
    hideModal('local-project-modal');
  });
} else console.error('btn-cancel-local not found');

document.getElementById('btn-browse-folder').addEventListener('click', async () => {
  const folder = await window.electronAPI.selectFolder();
  if (folder) document.getElementById('local-project-path').value = folder;
});

const btnCreateLocal = document.getElementById('btn-create-local');
if (btnCreateLocal) {
  btnCreateLocal.addEventListener('click', async () => {
    console.log('Local create clicked');
    const name = document.getElementById('local-project-name').value.trim();
    const path = document.getElementById('local-project-path').value.trim();
    if (!name) { alert('Please enter a project name'); return; }
    if (!path) { alert('Please select a folder'); return; }
    const result = await window.electronAPI.createLocalProject(name, path);
    if (result.ok) {
      hideModal('local-project-modal');
      WorkspaceManager.openProject(name, name);
    } else if (result.error === 'exists') {
      alert('Project already exists');
    } else {
      alert('Folder not found');
    }
  });
} else console.error('btn-create-local not found');

document.getElementById('btn-start-open').addEventListener('click', loadProjectList);

document.getElementById('btn-start-dashboard').addEventListener('click', () => {
  document.getElementById('project-list').classList.add('hidden');
  document.getElementById('start-dashboard').classList.remove('hidden');
  document.getElementById('start-main-title').textContent = 'Dashboard';
  document.getElementById('start-main-subtitle').textContent = 'Time tracking across all projects';
  const container = document.getElementById('start-dashboard-container');
  if (typeof TimeTracking !== 'undefined') {
    TimeTracking.renderDashboard(container);
  }
});

document.getElementById('btn-start-settings').addEventListener('click', () => {
  hideAllModals();
  showModal('settings-modal');
  blurMonaco();
});

// ==================== PROJECT ====================

async function openProject(name) {
  const prevProject = currentProject;
  if (typeof LayoutManager !== 'undefined' && prevProject && prevProject !== name) {
    LayoutManager.save('project-' + prevProject);
  }
  currentProject = name;

  // Initialize .florde/ directory — silent if exists, dialog if not
  let _flordeReady = false;
  try {
    const hasFlorde = await window.electronAPI.flordeDir.check(name);
    if (hasFlorde) {
      // Already exists → init silently, no dialog
      await window.electronAPI.flordeDb.initDb(name);
      _flordeReady = true;
    } else {
      // Doesn't exist → ask user
      const lsKeys = Object.keys(localStorage).filter(k => k.endsWith('-' + name));
      const action = await showFlordeConfirmDialog(name, { exists: false, lsKeys });
      if (action === 'create' || action === 'create_migrate') {
        await window.electronAPI.flordeDb.ensureDir(name);
        await window.electronAPI.flordeDb.initDb(name);
        if (action === 'create_migrate' && lsKeys.length > 0) {
          migrateLocalStorageToFlorde(name);
        }
        TodoList._load();
        Notes._load();
        DecisionLog._load();
        AuditLog._load();
        _flordeReady = true;
      }
    }
    if (_flordeReady) {
      try { window._memoryFileList = await window.electronAPI.flordeFs.memoryList(name); } catch { window._memoryFileList = []; }
    }
  } catch (e) {
    console.error('.florde init failed:', e);
    window._memoryFileList = [];
  }

  document.getElementById('project-name').textContent = name;
  TodoList.setProject(name);
  Notes.setProject(name);
  RagManager.setProject(name);
  DecisionLog.setProject(name);
  AuditLog.setProject(name);
  if (typeof TimeTracking !== 'undefined') {
    TimeTracking.start(name);
  }

  let savedMessages = [];
  try {
    const session = await window.electronAPI.loadSession(name);
    savedMessages = (session && session.history) || [];
    // Migrate old messages: extract reasoning_content from >>| |<< blocks
    for (const msg of savedMessages) {
      if (msg.role === 'assistant' && !msg.reasoning_content && msg.content) {
        const m = msg.content.match(/>>\|\s*([\s\S]*?)\s*\|\|</);
        if (m) msg.reasoning_content = m[1].trim();
      }
    }
  } catch (e) {
    console.error('loadSession failed for', name, e);
  }
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
    for (const f of files) {
      try { await openTab(f, false); } catch (e) { console.error('openTab failed for', f, e); }
    }
    if (openTabs.length > 0) switchTab(0);
  }

  showAppView();
  if (typeof LayoutManager !== 'undefined' && LayoutManager.isInitialized) {
    LayoutManager.load('project-' + name);
  }
  renderFileTree();
  updateSandboxStatus();
  updatePrivacyIndicator();
  updateProviderDropdown();
  logToTerminal(`Opened project: ${name} (${currentProjectType})`, 'success');

  if (typeof ProjectDetector !== 'undefined') {
    ProjectDetector.detect(name);
  }

  if (chatHistory.length === 0) {
    const welcome = 'I\'m your AI coding assistant. I can help you write, explain, and debug code. ' +
      'Send me a message to get started!';
    chatHistory.push({ role: 'assistant', content: welcome });
    trimChatHistory();
  }
  renderChat();
}

// ==================== LOCALSTORAGE → .florde MIGRATION ====================

async function migrateLocalStorageToFlorde(projectName) {
  const prefix = '-';
  const keys = Object.keys(localStorage).filter(k => k.endsWith(prefix + projectName));
  let migrated = 0;
  for (const key of keys) {
    try {
      const value = localStorage.getItem(key);
      if (!value) continue;
      // Store in kv_store under namespace derived from key
      const ns = key.replace(prefix + projectName, '');
      await window.electronAPI.flordeDb.set(projectName, 'migrated', ns, value);
      migrated++;
    } catch (e) {
      console.error('Migration failed for key', key, e);
    }
  }
  // Also migrate current in-memory state
  try {
    for (const todo of TodoList._todos) {
      await window.electronAPI.flordeDb.run(projectName,
        'INSERT OR IGNORE INTO todos (id, text, done, created_at) VALUES (?, ?, ?, ?)',
        [todo.id, todo.text, todo.done ? 1 : 0, todo.createdAt || new Date().toISOString()]);
    }
    for (const [name, note] of Object.entries(Notes._notes)) {
      await window.electronAPI.flordeDb.run(projectName,
        'INSERT OR REPLACE INTO notes (name, content, updated_at) VALUES (?, ?, ?)',
        [name, note.content, new Date(note.updatedAt || Date.now()).toISOString()]);
    }
    for (const dec of DecisionLog._decisions) {
      await window.electronAPI.flordeDb.run(projectName,
        'INSERT OR IGNORE INTO decisions (title, decision, rationale, alternatives, created_at) VALUES (?, ?, ?, ?, ?)',
        [dec.title, dec.reasons || '', dec.reasons || '', JSON.stringify(dec.alternatives || []),
         new Date(dec.createdAt || Date.now()).toISOString()]);
    }
  } catch (e) {
    console.error('State migration failed:', e);
  }
  showNotification('success', `Migrated ${migrated} localStorage entries to .florde/ for "${projectName}"`);
  // Reload project state from DB
  TodoList._load();
  Notes._load();
  DecisionLog._load();
  AuditLog._load();
}

// ==================== PLUGIN MARKETPLACE ====================

document.getElementById('btn-start-plugins').addEventListener('click', () => {
  hideAllModals();
  showModal('plugin-modal');
  if (pluginRegistry && pluginRegistry._loaded) renderPluginMarketplace();
});

document.getElementById('btn-plugins')?.addEventListener('click', () => {
  hideAllModals();
  showModal('plugin-modal');
  if (pluginRegistry && pluginRegistry._loaded) renderPluginMarketplace();
});

document.getElementById('btn-close-plugins').addEventListener('click', () => {
  hideModal('plugin-modal');
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
  hideModal('plugin-docs-modal');
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
    hideModal('plugin-docs-modal');
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
  if (typeof TimeTracking !== 'undefined') {
    TimeTracking.stop();
  }
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
  try {
    await window.electronAPI.saveSession(currentProject, { history: historyToSave });
  } catch (e) {
    console.error('saveSession failed:', e);
  }
  renderTabs();
}

async function saveAllTabs() {
  const currentContent = editor ? editor.getValue() : '';
  for (let f of Object.keys(tabContents)) {
    tabContents[f] = f === getActiveFileName() ? currentContent : tabContents[f];
    if (currentProject) {
      try {
        await window.electronAPI.projectWriteFile(currentProject, f, tabContents[f]);
      } catch (e) {
        console.error('saveAllTabs: failed to save', f, e);
      }
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
  if (index < 0 || index >= openTabs.length) return;
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
    renderInlineDiffDecorations(name);
    if (editor && editor.layout) {
      requestAnimationFrame(() => editor.layout());
    }
  }
  renderTabs();
}

let _closingTab = false;
async function closeTab(index) {
  if (_closingTab) return;
  _closingTab = true;
  try {
    if (index < 0 || index >= openTabs.length) return;
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
  } finally {
    _closingTab = false;
  }
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
      const d = modelDisposables.get(oldName);
      if (d) { modelDisposables.set(newName, d); modelDisposables.delete(oldName); }
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

document.getElementById('btn-close-all-tabs')?.addEventListener('click', closeAllTabs);

document.getElementById('btn-sidebar-toggle')?.addEventListener('click', () => {
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
    let cur = treeItem.parentElement?.closest('.tree-dir');
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
    if (msg.role === 'tool') continue;
    if (msg.role === 'assistant' && !msg.content && msg.tool_calls) continue;
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
    div.innerHTML = `<div class="msg-label">${label}${modelHint} <button class="copy-msg" data-content="${encodeURIComponent(msg.content || '')}">Copy</button></div>` + msgHtml;
    container.appendChild(div);
    if (msg.role === 'assistant' && msg.content) {
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'ai-actions';
      const actions = [
        ['🔍', 'Search Errors', 'search_errors'],
        ['⚡', 'Performance', 'performance'],
        ['🧪', 'Test', 'test'],
        ['✅', 'To-Do', 'todo'],
        ['🎯', 'Priority', 'priority'],
        ['📅', 'Deadline', 'deadline'],
        ['🚀', 'Implementation', 'implementation'],
        ['❓', 'Why', 'why'],
      ];
      for (const [icon, label, action] of actions) {
        const btn = document.createElement('button');
        btn.className = 'ai-action-btn';
        btn.dataset.action = action;
        btn.innerHTML = icon + ' ' + label;
        btn.addEventListener('click', async () => {
          const prompts = {
            search_errors: 'Search for errors/bugs in the following code. Analyze thoroughly and list all issues:\n\n',
            performance: 'Analyze the performance and suggest optimizations for the following code:\n\n',
            test: 'Create comprehensive tests for the following code:\n\n',
            todo: 'Convert the following tasks into a structured to-do list. Format as a Markdown list:\n\n',
            priority: 'Set priorities (high/medium/low) for the following tasks and justify each:\n\n',
            deadline: 'Suggest realistic deadlines for the following tasks. Consider dependencies:\n\n',
            implementation: 'Suggest a concrete implementation for the following requirements:\n\n',
            why: 'Explain the following code/flow in detail. Describe the why:\n\n',
          };
          const prompt = prompts[action] || '';
          await sendMessage(prompt + msg.content);
        });
        actionsDiv.appendChild(btn);
      }
      container.appendChild(actionsDiv);
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
  localStorage.setItem('florde-agent-mode', isPlan ? 'build' : 'plan');
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
  const providerValue = document.getElementById('provider-select').value;
  let providerId, model;
  if (providerValue.startsWith('route:')) {
    const route = AIRouter._routes.find(r => r.id === providerValue.slice(6));
    providerId = route?.provider || 'openai';
    model = route?.model || '';
  } else {
    providerId = providerValue;
    model = providers[providerId]?.model || '';
  }
  const caps = getKnownCapabilities(providerId, model);
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
  if (content == null) return '';
  const seeThoughts = getToggle('see-thoughts');
  let html = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (seeThoughts) {
    html = html.replace(/\[think\]([\s\S]*?)\[\/think\]/g, '<div class="think-block">$1</div>');
    html = html.replace(/>>\|([\s\S]*?)\|<</g, '<div class="think-block">$1</div>');
  } else {
    html = html.replace(/\[think\][\s\S]*?\[\/think\]/g, '');
    html = html.replace(/>>\|[\s\S]*?\|<</g, '');
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
chatInput?.addEventListener('input', () => { updateTokenCount(); autoResizeTextarea(chatInput); });
chatInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// Stop button state

function toggleSendStop() {
  if (VisionSession.active) {
    VisionSession.revoke('manual');
    const aborter = _requestAborter;
    if (aborter) aborter.abort();
    return;
  }
  if (_isRequestActive) {
    _stoppedByUser = true;
    _isRequestActive = false;
    if (_backoffTimer) { clearTimeout(_backoffTimer); _backoffTimer = null; }
    resetSendButton();
    const aborter = _requestAborter;
    _requestAborter = null;
    if (aborter) aborter.abort();
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
    try { const pt = JSON.parse(task); badge.title = 'Pending task: ' + (pt.plan || '').slice(0, 80); } catch { badge.title = 'Pending task'; }
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
    <div class="audit-stat"><span class="num all">${auditLog.length}</span><span class="label">Total</span></div>
    <div class="audit-stat"><span class="num cloud">${cloud}</span><span class="label">Cloud</span></div>
    <div class="audit-stat"><span class="num local">${local}</span><span class="label">Local</span></div>
  `;
  document.getElementById('audit-summary').innerHTML = summaryHtml;
  if (filtered.length === 0) {
    container.innerHTML = '<div style="color:var(--text3);padding:1rem;text-align:center;">No entries</div>';
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
  showModal('audit-modal');
  renderAuditLog();
});

document.getElementById('btn-close-audit').addEventListener('click', () => {
  hideModal('audit-modal');
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
    hideModal('git-modal');
    document.getElementById('git-commit-name').value = '';
    document.getElementById('git-commit-desc').value = '';
    document.getElementById('git-diff-preview').textContent = '';
    if (typeof GitPanel !== 'undefined') GitPanel.refresh();
  } else {
    logToTerminal('Git commit failed: ' + (result.error || 'unknown'), 'error');
  }
});

document.getElementById('btn-close-git').addEventListener('click', () => {
  hideModal('git-modal');
});

document.getElementById('btn-git-commit-show')?.addEventListener('click', async () => {
  if (!currentProject) { logToTerminal('No project open for git commit', 'error'); return; }
  const projectRoot = await window.electronAPI.getProjectRoot(currentProject);
  if (!projectRoot) { logToTerminal('No project root for git commit', 'error'); return; }
  const status = await window.electronAPI.gitStatus(projectRoot);
  if (!status) { logToTerminal('Not a git repository or no changes', 'warn'); return; }
  const diff = await window.electronAPI.gitDiff(projectRoot);
  document.getElementById('git-diff-preview').textContent = diff || 'No changes to commit';
  showModal('git-modal');
  document.getElementById('git-commit-name').focus();
});

// ==================== PRIVACY & PROVIDER ====================

document.getElementById('provider-select').addEventListener('change', () => { updatePrivacyIndicator(); updateModelInfoBadge(); });

function sanitizePath(filePath) {
  let normalized = filePath.replace(/\\/g, '/');
  normalized = normalized.replace(/^\.\.\/?/g, '');
  while (normalized.includes('/../')) {
    normalized = normalized.replace(/\/[^/]+\/\.\.(\/|$)/g, '/');
  }
  normalized = normalized.replace(/^\.\.\/?/g, '');
  normalized = normalized.replace(/\/+/g, '/').replace(/^\//, '');
  return normalized || '_';
}

// ==================== ACTIVITY DISPLAY (module-level) ====================
function setActivity(text) {
  let el = document.querySelector('.chat-activity');
  if (!el) {
    el = document.createElement('div');
    el.className = 'chat-activity';
    const lastMsg = document.querySelector('.chat-msg.ai:last-child');
    const container = document.getElementById('chat-messages');
    if (lastMsg && lastMsg.parentNode) {
      lastMsg.parentNode.insertBefore(el, lastMsg.nextSibling);
    } else if (container) {
      container.appendChild(el);
    }
  }
  el.textContent = text;
}
function clearActivity() {
  const el = document.querySelector('.chat-activity');
  if (el) el.remove();
}

async function executeToolCall(name, args) {
  const project = currentProject;
  const type = currentProjectType;

  const allowed = await PermissionManager.checkTool(name, args);
  if (!allowed) {
    return 'Permission denied: ' + name + ' is blocked';
  }

  setActivity(formatToolActivity(name, args));

  switch (name) {
    case 'read_file':
      if (!args || !args.path) throw new Error('path required for read_file');
      if (!project) throw new Error('No project open');
      addAuditEntry('local', 'Read_File: ' + sanitizePath(args.path));
      AuditLog.log({ type: 'file_read', action: 'File read', status: 'auto', summary: 'File ' + sanitizePath(args.path) + ' read', details: { file: sanitizePath(args.path) }, source: 'AI' });
      logToTerminal('Read_File: ' + sanitizePath(args.path), 'info');
      return await window.electronAPI.projectReadFile(project, sanitizePath(args.path));

    case 'write_file':
      if (!args) throw new Error('args required');
      if (!project) throw new Error('No project open');
      // Support batch write via {files: {"path": "content", ...}}
      if (args.files && typeof args.files === 'object') {
        const written = [];
        for (const [filePath, content] of Object.entries(args.files)) {
          const sp = sanitizePath(filePath);
          let _batchOldContent = '';
          try { _batchOldContent = await window.electronAPI.projectReadFile(project, sp) || ''; } catch (e) {}
          await window.electronAPI.projectWriteFile(project, sp, content);
          if (typeof DiffView !== 'undefined') DiffView.addChange(sp, _batchOldContent, content);
          const wfIdx = openTabs.indexOf(sp);
          if (wfIdx >= 0) {
            tabContents[sp] = content;
            tabDirty[sp] = false;
            if (wfIdx === activeTabIndex && editor) {
              applyInlineDiffToEditor(sp, content);
            }
          }
          written.push(sp);
        }
        addAuditEntry('local', 'Batch_Write: ' + written.join(', '));
        AuditLog.log({ type: 'file_write', action: 'File written', status: 'auto', summary: 'Batch: ' + written.length + ' files written', details: { files: written }, source: 'AI' });
        logToTerminal('Batch_Write: ' + written.join(', '), 'info');
        // Auto git commit
        try {
          const gitDir = currentProjectType === 'local' ? await window.electronAPI.getProjectRoot(project) : null;
          if (gitDir) {
            await window.electronAPI.sandboxExec(gitDir, 'git add -A 2>nul && git commit -m "Auto-commit: batch write ' + written.length + ' files" 2>nul');
          }
        } catch {}
        renderFileTree();
        DiffViewer.show(written.map(sp => ({ name: sp, content: args.files[sp] || '', language: detectLanguage(sp) })));
        return 'Batch written ' + written.length + ' files: ' + written.join(', ');
      }
      const _writePath = sanitizePath(args.path);
      addAuditEntry('local', 'Write_File: ' + _writePath);
      AuditLog.log({ type: 'file_write', action: 'File written', status: 'auto', summary: 'File ' + _writePath + ' written', details: { file: _writePath }, source: 'AI' });
      logToTerminal('Write_File: ' + _writePath, 'info');
      let _oldContent = '';
      try { _oldContent = await window.electronAPI.projectReadFile(project, _writePath) || ''; } catch (e) {}
      await window.electronAPI.projectWriteFile(project, _writePath, args.content);
      if (typeof DiffView !== 'undefined') DiffView.addChange(_writePath, _oldContent, args.content);
      // Live editor sync: reload if open in a tab
      const wfIdx = openTabs.indexOf(_writePath);
      if (wfIdx >= 0) {
        tabContents[_writePath] = args.content;
        tabDirty[_writePath] = false;
        if (wfIdx === activeTabIndex && editor) {
          applyInlineDiffToEditor(_writePath, args.content);
        }
      }
      renderFileTree();
      if (!(wfIdx >= 0 && wfIdx === activeTabIndex && editor)) {
        DiffViewer.show([{ name: _writePath, content: args.content, language: detectLanguage(_writePath) }]);
      }
      // Auto git commit if in a git repo
      try {
        const gitDir = currentProjectType === 'local' ? await window.electronAPI.getProjectRoot(project) : null;
        if (gitDir) {
          await window.electronAPI.sandboxExec(gitDir, 'git add -A 2>nul && git commit -m "Auto-commit: ' + (args.description || 'update ' + sanitizePath(args.path)).replace(/"/g, "'") + '" 2>nul');
        }
      } catch {}
      return 'File written: ' + sanitizePath(args.path);

    case 'delete_file':
      if (!args || !args.path) throw new Error('path required for delete_file');
      if (!project) throw new Error('No project open');
      const delPath = sanitizePath(args.path);
      addAuditEntry('local', 'Delete_File: ' + delPath);
      AuditLog.log({ type: 'file_write', action: 'File deleted', status: 'auto', summary: 'File ' + delPath + ' deleted', details: { file: delPath }, source: 'AI' });
      logToTerminal('Delete_File: ' + delPath, 'info');
      await window.electronAPI.projectDeleteFile(project, delPath);
      const delIdx = openTabs.indexOf(delPath);
      if (delIdx >= 0) {
        const disp = modelDisposables.get(delPath);
        if (disp) { disp.dispose(); modelDisposables.delete(delPath); }
        const mdl = monaco.editor.getModels().find(m => m.uri.path === '/' + delPath);
        if (mdl) mdl.dispose();
        openTabs.splice(delIdx, 1);
        if (delIdx <= activeTabIndex) activeTabIndex = Math.max(0, activeTabIndex - 1);
        if (activeTabIndex >= openTabs.length) activeTabIndex = openTabs.length - 1;
        renderTabs();
      }
      renderFileTree();
      return 'File deleted: ' + delPath;

    case 'list_files':
      if (!project) throw new Error('No project open');
      const files = await window.electronAPI.projectListFiles(project);
      renderFileTree();
      return JSON.stringify(files);

    case 'search_files':
      if (!args || !args.query) throw new Error('query required for search_files');
      if (!project) throw new Error('No project open');
      const results = await window.electronAPI.searchInFiles(project, args.query);
      return JSON.stringify(results);

    case 'exec_command':
      if (!args || !args.command) throw new Error('command required for exec_command');
      if (!project) throw new Error('No project open');
      const execDir = currentProjectType === 'local' ? await window.electronAPI.getProjectRoot(project) : sandboxDir;
      if (!execDir) throw new Error('AI Sandbox not configured');
      logToTerminal('AI executing: ' + args.command + ' in ' + execDir, 'command');
      const risk = assessShellRisk(args.command);
      logToTerminal('Shell risk level: ' + risk, risk === 'critical' || risk === 'high' ? 'warn' : 'info');
      const execResult = await window.electronAPI.sandbox.exec(args.command, { cwd: execDir });
      const outputText = typeof execResult === 'string' ? execResult : (execResult && execResult.output ? execResult.output : '');
      // Insert expandable shell view into the current AI message
      const shellView = showExpandableShellView(args.command, outputText);
      const aiMsg = document.querySelector('.chat-msg.ai:last-child');
      if (aiMsg) aiMsg.appendChild(shellView);
      logToTerminal('Command output: ' + outputText.substring(0, 500), 'info');
      return outputText;

    case 'ask_question':
      if (!args || !args.question) throw new Error('question required for ask_question');
      showNotification('question', 'Florde Has a Question \u2014 Check the question dialog', '\u2753');
      return await askUserQuestion(args.question, args.choices);

    case 'edit_file':
      if (!args || !args.path || !args.oldString || args.newString === undefined) throw new Error('path, oldString, and newString required for edit_file');
      if (!project) throw new Error('No project open');
      addAuditEntry('local', 'Edit_File: ' + sanitizePath(args.path));
      AuditLog.log({ type: 'file_write', action: 'File modified', status: 'auto', summary: 'File ' + sanitizePath(args.path) + ' modified', details: { file: sanitizePath(args.path) }, source: 'AI' });
      logToTerminal('Edit_File: ' + sanitizePath(args.path), 'info');
      {
        const efPath = sanitizePath(args.path);
        let content = await window.electronAPI.projectReadFile(project, efPath);
        const _efOldContent = content;
        const oldStr = args.oldString;
        const newStr = args.newString;
        if (args.replaceAll) {
          if (!content.includes(oldStr)) {
            throw new Error('oldString not found in ' + efPath);
          }
          content = content.split(oldStr).join(newStr);
        } else {
          const idx = content.indexOf(oldStr);
          if (idx === -1) {
            throw new Error('oldString not found in ' + efPath + '. Provide the exact text to replace.');
          }
          content = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
        }
        await window.electronAPI.projectWriteFile(project, efPath, content);
        if (typeof DiffView !== 'undefined') DiffView.addChange(efPath, _efOldContent, content);
        const efIdx = openTabs.indexOf(efPath);
        if (efIdx >= 0) {
          tabContents[efPath] = content;
          tabDirty[efPath] = false;
          if (efIdx === activeTabIndex && editor) {
            applyInlineDiffToEditor(efPath, content);
          }
        }
        renderFileTree();
        if (!(efIdx >= 0 && efIdx === activeTabIndex && editor)) {
          DiffViewer.show([{ name: efPath, content, language: detectLanguage(efPath) }]);
        }
        try {
          const gitDir = currentProjectType === 'local' ? await window.electronAPI.getProjectRoot(project) : null;
          if (gitDir) {
            await window.electronAPI.sandboxExec(gitDir, 'git add -A 2>nul && git commit -m "Auto-commit: ' + (args.description || 'edit ' + efPath).replace(/"/g, "'") + '" 2>nul');
          }
        } catch {}
        return 'File edited: ' + efPath;
      }

    case 'rename_file':
      if (!args || !args.path || !args.new_path) throw new Error('path and new_path required for rename_file');
      if (!project) throw new Error('No project open');
      const oldPath = sanitizePath(args.path);
      const newPath = sanitizePath(args.new_path);
      addAuditEntry('local', 'Rename_File: ' + oldPath + ' -> ' + newPath);
      AuditLog.log({ type: 'file_write', action: 'File renamed', status: 'auto', summary: oldPath + ' -> ' + newPath, details: { from: oldPath, to: newPath }, source: 'AI' });
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

    case 'vision_request':
      AuditLog.log({ type: 'vision', action: 'Vision angefragt', status: 'auto', summary: 'KI fragt nach Vision (Bildschirm sehen)', details: {}, source: 'KI' });
      VisionSession.requestAccess();
      return 'Vision requested. The user must approve via the confirmation dialog. Ask them to confirm using ask_question or wait.';

    case 'take_screenshot':
      addAuditEntry('local', 'Take_Screenshot');
      AuditLog.log({ type: 'unknown', action: 'Screenshot erstellt', status: 'auto', summary: 'Screenshot erstellt', details: {}, source: 'KI' });
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const track = stream.getVideoTracks()[0];
        const canvas = document.createElement('canvas');
        let w, h;
        try {
          const capture = new ImageCapture(track);
          const frame = await capture.grabFrame();
          w = frame.displayWidth || frame.codedWidth || 1920;
          h = frame.displayHeight || frame.codedHeight || 1080;
          canvas.width = Math.min(w, 1920);
          canvas.height = h * (canvas.width / w);
          canvas.getContext('2d').drawImage(frame, 0, 0, canvas.width, canvas.height);
          frame.close();
        } catch {
          canvas.width = 800; canvas.height = 600;
          canvas.getContext('2d').fillText('Screenshot unavailable', 10, 20);
        }
        track.stop();
        stream.getTracks().forEach(t => t.stop());
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
      AuditLog.log({ type: 'command', action: 'Aufgabe geplant', status: 'auto', summary: 'Aufgabe geplant: ' + (args.plan || '').slice(0, 80), details: { plan: (args.plan || '').slice(0, 200) }, source: 'KI' });
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
      if (!args || !args.url) throw new Error('url required for browser_open');
      if (typeof BrowserPanel === 'undefined') throw new Error('BrowserPanel not available');
      BrowserPanel.show();
      await BrowserPanel.navigate(args.url);
      return 'Opened: ' + args.url;
    case 'browser_click':
      if (!args || !args.selector) throw new Error('selector required for browser_click');
      if (typeof BrowserPanel === 'undefined') throw new Error('BrowserPanel not available');
      BrowserPanel.show();
      await BrowserPanel.evaluate(`document.querySelector(${JSON.stringify(args.selector)}).click()`);
      return 'Clicked: ' + args.selector;
    case 'browser_type':
      if (!args || !args.selector || args.text === undefined) throw new Error('selector and text required for browser_type');
      if (typeof BrowserPanel === 'undefined') throw new Error('BrowserPanel not available');
      BrowserPanel.show();
      await BrowserPanel.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(args.selector)});
        if (!el) throw new Error('Element not found: ' + ${JSON.stringify(args.selector)});
        el.value = ${JSON.stringify(args.text)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
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
      if (!args || !args.code) throw new Error('code required for browser_evaluate');
      if (typeof BrowserPanel === 'undefined') throw new Error('BrowserPanel not available');
      BrowserPanel.show();
      const evalResult = await BrowserPanel.evaluate(args.code);
      return 'Result: ' + (typeof evalResult === 'object' ? JSON.stringify(evalResult) : String(evalResult));

    case 'spawn_subagent':
      if (!args || !args.goal || !args.context) throw new Error('goal and context required for spawn_subagent');
      const session = ChatManager.getActive();
      const parentSessionId = session?.id || 'unknown';

      appendSubagentStatus(parentSessionId, `⚡ Spawning subagent for: ${args.goal.slice(0, 80)}...`);

      const subagent = window.SubagentManager.create(
        parentSessionId,
        args.goal,
        args.context,
        async (toolName, toolArgs) => {
          return true;
        },
        (type, data) => {
          if (typeof window._subagentLiveCallback === 'function') {
            window._subagentLiveCallback(subagent.id, type, data);
          }
          if (type === 'system') {
            appendSubagentStatus(parentSessionId, data);
          }
        }
      );

      subagent.start().catch(err => {
        console.error('Subagent failed:', err);
        appendSubagentStatus(parentSessionId, `❌ Subagent ${subagent.id} fehlgeschlagen: ${err.message}`);
      });

      return `Subagent '${subagent.id}' gestartet mit Aufgabe: ${args.goal}`;

    default:
      // Check if this is a connected app tool (e.g. make_list_scenarios)
      if (APP_TOOL_LOOKUP[name]) {
        return await executeAppTool(name, args);
      }
      if (typeof pluginRegistry !== 'undefined' && pluginRegistry.toolHandlers.has(name)) {
        return await pluginRegistry.executeTool(name, args);
      }
      // MCP tools
      if (name.startsWith('mcp_')) {
        for (const [id, client] of _mcpClients) {
          if (!client._connected) continue;
          const tool = client._tools.find(t => t.name === name);
          if (tool) {
            const result = await client.callTool(tool._originalName, args);
            return JSON.stringify(result.content || result);
          }
        }
        throw new Error('MCP tool not found: ' + name);
      }
      throw new Error('Unknown tool: ' + name);
  }
}

function appendSubagentStatus(sessionId, text) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  const statusEl = document.createElement('div');
  statusEl.className = 'chat-msg ai subagent-status';
  statusEl.dataset.sessionId = sessionId;
  statusEl.innerHTML = '<div class="msg-label">Subagent-Status</div><div class="subagent-status-text">' + formatMessageContent(text) + '</div>';
  container.appendChild(statusEl);
  container.scrollTop = container.scrollHeight;
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
    opencodezen: { tool_calling: true, streaming: true, json_mode: true, vision: m.includes('gpt-5') || m.includes('claude') || m.includes('gemini') || m.includes('grok-4') || m.includes('vision'), thinking: false, images: false, embeddings: false, function_calling: true, custom_temperature: true, seed: true, context_caching: false },
    opencodego: { tool_calling: true, streaming: true, json_mode: true, vision: m.includes('vision-exp') || m.includes('grok'), thinking: false, images: false, embeddings: false, function_calling: true, custom_temperature: true, seed: false, context_caching: false },
    ollama: { tool_calling: undefined, streaming: true, json_mode: false, vision: m.includes('llava') || m.includes('vision'), thinking: false, images: false, embeddings: false, function_calling: true, custom_temperature: true, seed: true, context_caching: false },
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
    const textarea = document.getElementById('plan-content');
    const editToggle = document.getElementById('plan-edit-toggle');
    const stepProgress = document.getElementById('plan-step-progress');
    textarea.value = plan;
    textarea.readOnly = true;
    editToggle.checked = false;
    editToggle.onchange = () => { textarea.readOnly = !editToggle.checked; };
    stepProgress.textContent = '';
    showModal('plan-modal');
    const execute = document.getElementById('btn-plan-execute');
    const cancel = document.getElementById('btn-plan-cancel');
    const cleanup = () => {
      hideModal('plan-modal');
      editToggle.onchange = null;
      execute.removeEventListener('click', onExecute);
      cancel.removeEventListener('click', onCancel);
    };
    const onExecute = () => { cleanup(); resolve(textarea.value); };
    const onCancel = () => { cleanup(); resolve(false); };
    execute.addEventListener('click', onExecute);
    cancel.addEventListener('click', onCancel);
  });
}

function formatToolArg(name, args) {
  const detailed = getToggle('detailed-activity');
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
  const detailed = getToggle('detailed-activity');
  let arg = (args && (args.path || args.command || args.question || args.query || (args.code && args.code.slice(0, 40)))) || '';
  if (!arg) return label;
  if (!detailed && args.path) arg = args.path.split('/').pop() || args.path;
  return label + ' ' + arg;
}

async function summarizeChat() {
  const totalChars = chatHistory.reduce((s, m) => s + (m.content || '').length, 0);
  if (totalChars < SUMMARY_THRESHOLD) return;
  const { provider: prov } = resolveProvider();
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

async function handleFlordeCommand(text) {
  const project = currentProject;
  if (!project) return false;
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0];
  if (cmd === '!memory' || cmd === '!rules' || cmd === '!temp') {
    chatHistory.push({ role: 'user', content: text });
    trimChatHistory();
    renderChat();
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-msg ai';
    msgDiv.innerHTML = '<div class="msg-label">Florde AI</div>';
    document.getElementById('chat-messages').appendChild(msgDiv);
    const contentDiv = document.createElement('div');
    msgDiv.appendChild(contentDiv);
    try {
      let result = '';
      if (cmd === '!rules') {
        const content = await window.electronAPI.flordeFs.memoryRead(project, 'rules.md');
        result = '📋 **rules.md**:\n\n```markdown\n' + (content || '*empty*') + '\n```';
      } else if (cmd === '!memory') {
        if (parts[1] === 'save' && parts.length >= 3) {
          const key = parts[2];
          const value = parts.slice(3).join(' ');
          const current = await window.electronAPI.flordeFs.memoryRead(project, 'memory.md') || '';
          const updated = current + '\n- **' + key + '**: ' + value + '\n';
          await window.electronAPI.flordeFs.memoryWrite(project, 'memory.md', updated);
          result = '✅ Saved to memory.md';
        } else if (parts[1] === 'show' || parts.length === 1) {
          const content = await window.electronAPI.flordeFs.memoryRead(project, 'memory.md');
          result = '📝 **memory.md**:\n\n```markdown\n' + (content || '*empty*') + '\n```';
        } else if (parts[1] === 'clear') {
          const def = '# AI Memory\n\n*Key context the AI should remember across sessions.*\n';
          await window.electronAPI.flordeFs.memoryWrite(project, 'memory.md', def);
          result = '✅ memory.md cleared';
        } else if (parts[1] === 'list') {
          const files = await window.electronAPI.flordeFs.memoryList(project);
          result = '📂 **Memory files**:\n' + files.map(f => '- ' + f).join('\n');
        } else {
          const file = parts[1];
          const content = await window.electronAPI.flordeFs.memoryRead(project, file);
          result = '📄 **' + file + '**:\n\n```markdown\n' + (content || '*empty*') + '\n```';
        }
      } else if (cmd === '!temp') {
        if (parts[1] === 'list' || parts.length === 1) {
          const files = await window.electronAPI.flordeFs.tempList(project);
          result = '📂 **Temp files**:\n' + (files.length ? files.map(f => '- ' + f.name + ' (' + f.size + 'b)').join('\n') : '*empty*');
        } else if (parts[1] === 'read' && parts[2]) {
          const content = await window.electronAPI.flordeFs.tempRead(project, parts[2]);
          result = '📄 **' + parts[2] + '**:\n\n```\n' + (content || '*not found*') + '\n```';
        } else if (parts[1] === 'write' && parts[2] && parts.length >= 4) {
          const fn = parts[2];
          const content = parts.slice(3).join(' ');
          await window.electronAPI.flordeFs.tempWrite(project, fn, content);
          result = '✅ Written to temp/' + fn;
        } else if (parts[1] === 'delete' && parts[2]) {
          await window.electronAPI.flordeFs.tempDelete(project, parts[2]);
          result = '✅ Deleted temp/' + parts[2];
        } else {
          result = 'Usage: !temp (list|read <file>|write <file> <content>|delete <file>)';
        }
      }
      contentDiv.innerHTML = formatMessageContent(result);
    } catch (e) {
      contentDiv.innerHTML = formatMessageContent('❌ Error: ' + e.message);
    }
    chatHistory.push({ role: 'assistant', content: contentDiv.textContent || contentDiv.innerText || '' });
    trimChatHistory();
    renderChat();
    document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
    return true;
  }

  // ===== Slash commands =====

  // /help
  if (cmd === '/help') {
    chatHistory.push({ role: 'user', content: '📖 Help' });
    trimChatHistory();
    renderChat();
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-msg ai';
    msgDiv.innerHTML = '<div class="msg-label">Florde AI</div>';
    document.getElementById('chat-messages').appendChild(msgDiv);
    const contentDiv = document.createElement('div');
    msgDiv.appendChild(contentDiv);
    const staticCmds = [
      { icon: '📖', cmd: '/help', desc: 'Show all available commands' },
      { icon: '📄', cmd: '/summarize', desc: 'Summarize the last task' },
      { icon: '📄', cmd: '/summarize all', desc: 'Summarize the entire conversation' },
      { icon: '⚡', cmd: '/git status', desc: 'Show git repository status' },
      { icon: '⚡', cmd: '/git log [n]', desc: 'Show git commits (default: 10)' },
      { icon: '⚡', cmd: '/run <command>', desc: 'Execute shell command (AI runs it, e.g. /run npm start)' },
    ];
    const staticHtml = '**Commands:**\n\n' + staticCmds.map(c => c.icon + ' **' + c.cmd + '** — ' + c.desc).join('\n');
    let appHtml = '';
    if (window._connectedAppIds && window._connectedAppIds.length && typeof CONNECTED_APPS !== 'undefined') {
      const appLines = window._connectedAppIds.map(id => {
        const app = CONNECTED_APPS.find(a => a.id === id);
        return app ? app.icon + ' **/' + id + '** — ' + app.desc : null;
      }).filter(Boolean);
      if (appLines.length) {
        appHtml = '\n\n**Verbundene Dienste:**\n' + appLines.join('\n');
      }
    }
    contentDiv.innerHTML = formatMessageContent(staticHtml + appHtml);
    chatHistory.push({ role: 'assistant', content: contentDiv.textContent || contentDiv.innerText || '' });
    trimChatHistory();
    renderChat();
    document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
    return true;
  }

  // /git status
  if (cmd === '/git' && parts[1] === 'status') {
    chatHistory.push({ role: 'user', content: '⚡ Git Status' });
    trimChatHistory();
    renderChat();
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-msg ai';
    msgDiv.innerHTML = '<div class="msg-label">Florde AI</div>';
    document.getElementById('chat-messages').appendChild(msgDiv);
    const contentDiv = document.createElement('div');
    msgDiv.appendChild(contentDiv);
    try {
      const result = await window.electronAPI.gitStatus(project);
      if (!result) {
        contentDiv.innerHTML = formatMessageContent('✅ Clean working tree — no changes');
      } else {
        contentDiv.innerHTML = formatMessageContent('```\n' + result + '\n```');
      }
    } catch (e) {
      contentDiv.innerHTML = formatMessageContent('❌ Error: ' + e.message);
    }
    chatHistory.push({ role: 'assistant', content: contentDiv.textContent || contentDiv.innerText || '' });
    trimChatHistory();
    renderChat();
    document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
    return true;
  }

  // /git log [limit]
  if (cmd === '/git' && parts[1] === 'log') {
    const limit = parseInt(parts[2]) || 10;
    chatHistory.push({ role: 'user', content: '⚡ Git Log (letzte ' + limit + ')' });
    trimChatHistory();
    renderChat();
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-msg ai';
    msgDiv.innerHTML = '<div class="msg-label">Florde AI</div>';
    document.getElementById('chat-messages').appendChild(msgDiv);
    const contentDiv = document.createElement('div');
    msgDiv.appendChild(contentDiv);
    try {
      const commits = await window.electronAPI.gitLog(project, limit);
      if (!commits || commits.length === 0) {
        contentDiv.innerHTML = formatMessageContent('No commits found.');
      } else {
        const lines = commits.map(c => '`' + c.shortHash + '` ' + c.date + ' ' + c.author + ' — ' + c.message);
        contentDiv.innerHTML = formatMessageContent(lines.join('\n'));
      }
    } catch (e) {
      contentDiv.innerHTML = formatMessageContent('❌ Error: ' + e.message);
    }
    chatHistory.push({ role: 'assistant', content: contentDiv.textContent || contentDiv.innerText || '' });
    trimChatHistory();
    renderChat();
    document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
    return true;
  }

  return false;
}

async function sendMessage(text) {
  const input = document.getElementById('chat-input');
  if (!text) text = input.value.trim();
  if (!text) return;
  if (_isRequestActive) { logToTerminal('Request already in progress. Stop it first or wait.', 'warn'); return; }

  // Clean up any stale aborter from a previous failed request
  if (_requestAborter) { try { _requestAborter.abort(); } catch {} _requestAborter = null; }

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

  const _taskClassification = TaskClassifier.classify(text);

  // Risk-based snapshot preflight (VM backends only)
  window.__vmRisk = { level: 'low', needsSnapshot: false };
  try {
    const sbx = await window.electronAPI.sandbox.getConfig();
    const isVm = sbx.type === 'vmware' || sbx.type === 'qemu';
    if (isVm) {
      const risk = TaskClassifier._riskOf(text) || 'medium';
      window.__vmRisk.level = risk;
      if (risk === 'high') {
        window.__vmRisk.needsSnapshot = true;
        const name = 'pre-task-' + Date.now();
        const r = await window.electronAPI.sandbox.vmSnapshot(name);
        window.__vmRisk.snapshotTaken = !(r && r.ok === false);
        AuditLog.log({ type: 'vm', action: 'Snapshot erstellt (riskante Aufgabe)', status: 'auto', summary: 'Auto-Snapshot vor riskanter Aufgabe: ' + name, details: { name, risk }, source: 'KI' });
      }
    }
  } catch {}

  TaskRouter.renderTaskIndicator(_taskClassification);

  // Pre-process AI-targeted /commands before handleFlordeCommand
  let _hideUserMsg = false;
  const trimmed = text.trim();
  const firstSlash = trimmed.match(/^\/([a-zA-Z]+)/);
  if (firstSlash) {
    const slashCmd = firstSlash[1].toLowerCase();
    const rest = trimmed.slice(firstSlash[0].length).trim();
    if (slashCmd === 'summarize') {
      if (rest.toLowerCase() === 'all') {
        text = '📄 Summarize the entire conversation history comprehensively. Include key decisions, insights, and action items.';
      } else {
        text = '📄 Summarize the most recent task or exchange briefly. Focus on what was accomplished and any decisions made.';
      }
    } else if (slashCmd === 'run') {
      _hideUserMsg = true;
      text = '⚡ Execute the following command in the project using the exec_command tool: ' + rest;
    } else if (slashCmd === 'vision') {
      if (rest.toLowerCase() === 'allow') { VisionSession.grant(); }
      else if (rest.toLowerCase() === 'stop') { VisionSession.revoke('manual'); }
      _hideUserMsg = true;
    } else if (slashCmd !== 'help' && slashCmd !== 'git' && !trimmed.startsWith('!')) {
      const connectedApps = window._connectedAppIds || [];
      if (typeof CONNECTED_APPS !== 'undefined') {
        const appInfo = CONNECTED_APPS.find(a => a.id === slashCmd);
        if (appInfo && connectedApps.includes(slashCmd)) {
          text = '⚡ Using ' + appInfo.icon + ' ' + appInfo.name + ': ' + (rest || 'help') + '. Use the available ' + slashCmd + '_* tools.';
        }
      }
    }
  }

  // Handle .florde chat commands
  const handled = await handleFlordeCommand(text);
  if (handled) { if (input) input.value = ''; return; }

  const providerValue = document.getElementById('provider-select').value;
  let provider, providerId, isCloud;
  if (providerValue.startsWith('route:')) {
    const routeId = providerValue.slice(6);
    const route = AIRouter._routes.find(r => r.id === routeId);
    if (!route || !route.enabled) {
      logToTerminal('\u274C AI Router route not found or disabled.', 'error');
      if (input) input.value = text;
      return;
    }
    provider = AIRouter.getProviderForRoute(route);
    providerId = route.provider;
    isCloud = !['ollama','lmstudio','localai'].includes(route.provider);
    if (!provider) {
      logToTerminal('\u274C Could not create provider for route: ' + route.name + '. Check API key/URL.', 'error');
      if (input) input.value = text;
      return;
    }
  } else {
    providerId = providerValue;
    if (!providerId || !providers[providerId]) {
      logToTerminal('\u274C No AI provider enabled. Please enable a provider in settings or add an AI Router route.', 'error');
      if (input) input.value = text;
      return;
    }
    provider = providers[providerId];
    isCloud = providerId !== 'ollama' && providerId !== 'lmstudio' && providerId !== 'localai';
  }

  let _taskRouted = false;
  if (TaskRouter._enabled && (TaskRouter._mode !== 'manual' || Object.values(TaskRouter._taskModels).some(v => v))) {
    const taskResult = TaskRouter.getModelForTask(_taskClassification.primary, _attachedImages);
    if (taskResult) {
      provider = taskResult.provider;
      providerId = taskResult.providerId;
      isCloud = !['ollama','lmstudio','localai'].includes(taskResult.providerId);
      _taskRouted = true;
      logToTerminal('Task Router: ' + _taskClassification.primary + ' \u2192 ' + taskResult.model + ' (' + taskResult.providerId + ')', 'info');
    }
  }

  // Toggle button to Stop mode
  const _currentAborter = new AbortController();
  _requestAborter = _currentAborter;
  _isRequestActive = true;
  const sendBtn = document.getElementById('btn-send');
  sendBtn.textContent = 'Stop';
  sendBtn.classList.add('is-stopping');

  addAuditEntry(isCloud ? 'cloud' : 'local', 'Message sent to ' + providerId);
  AuditLog.log({ type: 'chat', action: 'Message sent', status: 'auto', summary: 'Message to ' + providerId + ' (' + (isCloud ? 'Cloud' : 'Local') + ')', details: { provider: providerId, mode: isCloud ? 'cloud' : 'local' }, source: 'AI' });
  updatePrivacyIndicator();

  const userImages = _attachedImages.length > 0 ? [..._attachedImages] : undefined;
  if (!_hideUserMsg) {
    chatHistory.push({ role: 'user', content: text, _images: userImages });
  }
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
    const instant = getToggle('instant-mode');
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
  let _planSteps = 0;
  let _currentStep = 0;
  if (document.getElementById('btn-agentic-mode')?.classList.contains('agentic-plan')) {
    const planPrompt = 'Create a concise step-by-step plan for this request. List specific files, commands, and order of operations:\n\n' + text;
    const planMessages = [
      { role: 'system', content: 'You are a planning AI. Output only the plan with clear steps.' },
      { role: 'user', content: planPrompt }
    ];
    let plan = '';
    startAnim('*Planning*');
    try {
      plan = await prov.sendPlain(planMessages);
    } catch (err) {
      if (_stoppedByUser || _timedOut || err.name === 'AbortError') throw err;
      logToTerminal('Plan generation failed, proceeding without plan: ' + err.message, 'warn');
    }
    stopAnim(plan);
    if (plan) {
      const editedPlan = await showPlanModal(plan);
      if (editedPlan === false) return;
      chatHistory.push({ role: 'system', content: 'Approved execution plan:\n' + editedPlan });
      _planSteps = (editedPlan.match(/^\d+\./gm) || []).length;
      _currentStep = 0;
      const stepEl = document.getElementById('plan-step-progress');
      if (stepEl) stepEl.textContent = '1/' + _planSteps;
    }
  }

  startAnim('*Thinking*');

  logToTerminal('Sending request to ' + providerId + '...', 'info');

  try {
    const timeoutMinutes = parseInt(document.getElementById('settings-timeout')?.value) || 30;
    let _timedOut = false;
    const onTimeout = () => {
      _timedOut = true;
      if (_requestAborter === _currentAborter && _requestAborter) _requestAborter.abort();
      stopAnim();
      cancelRequestWithTimeout('Request cancelled after ' + timeoutMinutes + ' minutes.');
      logToTerminal('Request timed out after ' + timeoutMinutes + ' minutes', 'error');
      resetSendButton();
    };
    startRequestTimeout(timeoutMinutes, onTimeout);
    _backoffStep = null;
    const prov = provider;
    const supportsTools = prov ? (prov.supportsTools ? true : await checkToolSupport(prov, providerId)) : false;
    const systemMsg = { role: 'system', content: buildSystemPrompt(supportsTools) };
    // RAG injection
    if (document.getElementById('rag-auto')?.checked && typeof RagManager !== 'undefined') {
      const ctx = RagManager.getContext(text);
      if (ctx) {
        systemMsg.content += '\n\nRelevant project context:\n' + ctx;
      }
    }
    const MAX_MSG_CHARS = 100000;
    const allImages = chatHistory.filter(m => m._images).flatMap(m => m._images).slice(-20);
    let messages = [systemMsg, ...chatHistory.map(m => {
      const base = { role: m.role, content: m.content || '' };
      if (m.tool_calls) base.tool_calls = m.tool_calls;
      if (m.tool_call_id) base.tool_call_id = m.tool_call_id;
      if (m.name) base.name = m.name;
      return base;
    })];
    if (_hideUserMsg) {
      messages.push({ role: 'user', content: text });
    }
    if (allImages.length > 0) {
      if (providerId === 'ollama') {
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
      totalChars = 0;
      for (const m of messages) totalChars += (m.content || '').length;
    }
    const MAX_BACKOFF_RETRIES = 5;
    async function fetchWithBackoff(fn) {
      while (true) {
        if (_timedOut || _stoppedByUser) throw new Error(_stoppedByUser ? 'Stopped by user' : 'Timed out');
        try {
          const result = await fn();
          _backoffStep = null;
          return result;
        } catch (err) {
          if (_timedOut || _stoppedByUser) throw err;
          const is429 = /429|rate.?limit/i.test(err.message || '');
          const isServerError = /^5\d\d/.test(String(err.message || '').match(/\d+/)?.[0] || '') || /500|502|503|504|server.?error|internal.?error/i.test(err.message || '');
          if (is429 || isServerError) {
            _backoffStep = (_backoffStep || 0) + 1;
            if (_backoffStep > MAX_BACKOFF_RETRIES) {
              _backoffStep = null;
              throw new Error(is429 ? 'Rate limited — max retries (' + MAX_BACKOFF_RETRIES + ') exceeded.' : 'Server error — max retries (' + MAX_BACKOFF_RETRIES + ') exceeded.');
            }
            const delay = getBackoffDelay(_backoffStep - 1);
            const reason = is429 ? 'Rate Limited' : 'Server Error (' + (err.message || '').slice(0, 30) + ')';
            setActivity(reason + ' — Retry in ' + Math.ceil(delay / 1000) + 's');
            logToTerminal(reason + ', retrying in ' + (delay / 1000) + 's (step ' + _backoffStep + ')', 'warn');
            await new Promise(r => { _backoffTimer = setTimeout(r, delay); });
            continue;
          }
          throw err;
        }
      }
    }

    let finalContent = '';
    let _lastReasoningContent = '';

    function _getReasoningContent(resp) {
      if (resp.reasoning_content) return resp.reasoning_content;
      const c = resp.content || '';
      const m = c.match(/>>\|\s*([\s\S]*?)\s*\|\|</);
      return m ? m[1].trim() : '';
    }

    // Loop Detection
    const loopDetector = new LoopDetector('main');
    const recoveryManager = new RecoveryManager();
    // Global loop detection across all agents
    if (!window._globalLoopDetector) {
      window._globalLoopDetector = new LoopDetector('global');
    }
    const globalLoopDetector = window._globalLoopDetector;
    const _ldSettings = (() => { try { return JSON.parse(localStorage.getItem('florde-settings') || '{}').loopDetection || {}; } catch { return {}; } })();
    if (_ldSettings.sensitivity) loopDetector._sensitivity = _ldSettings.sensitivity;

    if (supportsTools) {
      let toolRounds = 0;
      const maxRounds = 15;

      while (toolRounds < maxRounds) {
        const reminder = { role: 'user', content: buildToolReminder() };
        const msgsWithReminder = [reminder, ...messages];
        const response = await fetchWithBackoff(() => prov.sendWithTools(msgsWithReminder, getActiveTools()));
        if (_timedOut) return;
        stopAnim();
        resetRequestTimeout(timeoutMinutes, onTimeout);

        if (response.tool_calls && response.tool_calls.length > 0) {
          const hasText = response.content && response.content.trim().length > 0;
          if (hasText) {
            messages.push({ role: 'assistant', content: response.content });
            messages.push({ role: 'user', content: 'Fehler: entweder Tool-Call ODER Text, nicht beides.' });
            toolRounds++;
            startAnim('*Waiting for AI*');
            continue;
          }

          messages.push({ role: 'assistant', content: '', tool_calls: response.tool_calls });

          for (const toolCall of response.tool_calls) {
            const args = JSON.parse(toolCall.function.arguments || '{}');
            const name = toolCall.function.name;

            logToTerminal('AI uses tool: ' + name, 'ai');
            startAnim('*Running tool: ' + name + '*');

            if (_planSteps) {
              _currentStep = Math.min(_currentStep + 1, _planSteps);
              const stepEl = document.getElementById('plan-step-progress');
              if (stepEl) stepEl.textContent = _currentStep + '/' + _planSteps;
              const aiMsg = document.querySelector('.chat-msg.ai:last-child');
              if (aiMsg) {
                const sd = document.createElement('div');
                sd.className = 'agent-step';
                sd.innerHTML = '<span class="agent-step-num">Step ' + _currentStep + '/' + _planSteps + '</span> <span class="agent-step-name">' + formatToolActivity(name, args) + '</span><span class="agent-step-bar"><span class="agent-step-progress" style="width:' + (_currentStep / _planSteps * 100) + '%"></span></span>';
                aiMsg.appendChild(sd);
              }
            }

            stopAnim('*' + formatToolActivity(name, args) + '*');
            // Pause gate: hold tool dispatch while VM live-view pause is active
            while (window._vmPaused) {
              if (_requestAborter && _requestAborter.signal && _requestAborter.signal.aborted) break;
              startAnim('*Pausiert (Anhalten aktiv)*');
              await new Promise(r => setTimeout(r, 300));
            }
            if (_requestAborter && _requestAborter.signal && _requestAborter.signal.aborted) break;
            let result;
            try {
              result = await executeToolCall(name, args);
            } catch (err) {
              result = 'Error: ' + err.message;
            }
            messages.push(getToolResultMsg(toolCall.id, name, String(result).slice(0, 500)));

            // Record action for loop detection
            loopDetector.recordAction({
              timestamp: Date.now(),
              agentId: 'main',
              type: loopDetector._inferActionType(name),
              tool: name,
              command: args.command,
              file: args.file || args.path,
              args: args,
              result: String(result).slice(0, 500),
              resultHash: loopDetector._fingerprintResult(String(result).slice(0, 500)),
              success: !String(result).startsWith('Error:'),
              errorFingerprint: String(result).startsWith('Error:') ? loopDetector._fingerprintError(String(result)) : null,
              filesChanged: (name === 'edit_file' || name === 'write_file') ? [args.file || args.path || ''] : [],
            });
            // Also record to global detector
            globalLoopDetector.recordAction({
              timestamp: Date.now(),
              agentId: 'main',
              type: globalLoopDetector._inferActionType(name),
              tool: name,
              args: args,
              result: String(result).slice(0, 200),
              resultHash: globalLoopDetector._fingerprintResult(String(result).slice(0, 200)),
              success: !String(result).startsWith('Error:'),
              errorFingerprint: String(result).startsWith('Error:') ? globalLoopDetector._fingerprintError(String(result)) : null,
            });

            chatHistory.push({ role: 'assistant', content: null, tool_calls: [toolCall], model: provider });
            chatHistory.push(getToolResultMsg(toolCall.id, name, String(result).slice(0, 1000)));
            trimChatHistory();
          }

          // Loop detection analysis
          if (_ldSettings.enabled !== false) {
            const loopAnalysis = loopDetector.analyze();
            if (loopAnalysis.status === 'possible' && _ldSettings.showPossibleWarning !== false) {
              updateLoopIndicator('possible', loopAnalysis);
            } else if (loopAnalysis.status === 'confirmed' || loopAnalysis.status === 'critical') {
              const shouldStop = await handleLoopDetection(loopAnalysis);
              if (shouldStop) break;
            }
          }

          if (_requestAborter && _requestAborter.signal && _requestAborter.signal.aborted) break;
          toolRounds++;
          startAnim('*Waiting for AI*');
        } else {
          const text = response.content || '';
          const hasCodeBlock = /```[\s\S]*?```/.test(text);
          if (hasCodeBlock) {
            messages.push({ role: 'assistant', content: text });
            messages.push({ role: 'user', content: 'Code in Chat statt write_file/edit_file. Benutze das passende Tool.' });
            toolRounds++;
            startAnim('*Waiting for AI*');
            continue;
          }
          finalContent = text;
          _lastReasoningContent = _getReasoningContent(response);
          break;
        }
      }

      if (toolRounds >= maxRounds) {
        contentDiv.textContent = 'Tool call limit reached. Please try a simpler request.';
        logToTerminal('Tool call limit reached (max ' + maxRounds + ' rounds)', 'error');
        await saveSession();
        clearActivity();
        clearRequestTimeout();
        return;
      }
    } else {
      let toolRounds = 0;
      const maxRounds = 15;

      while (toolRounds < maxRounds) {
        const reminder = { role: 'user', content: buildToolReminder() };
        const msgsWithReminder = [reminder, ...messages];
        finalContent = await fetchWithBackoff(() => prov.sendMessage(msgsWithReminder, (chunk) => {
          stopAnim(chunk);
          resetRequestTimeout(timeoutMinutes, onTimeout);
        }));
        if (_timedOut) return;
        stopAnim(finalContent);
        resetRequestTimeout(timeoutMinutes, onTimeout);

        const textCalls = parseTextToolCalls(finalContent);
        if (textCalls.length > 0) {
          // Limit text tool calls per round to 3 to encourage individual messages
          const maxTextToolsPerRound = 3;
          const processedCalls = textCalls.slice(0, maxTextToolsPerRound);
          if (textCalls.length > maxTextToolsPerRound) {
            logToTerminal('Too many text tool calls (' + textCalls.length + '), processing first ' + maxTextToolsPerRound, 'warn');
          }
          logToTerminal('AI is using text tools: ' + processedCalls.map(t => t.function.name).join(', '), 'ai');
          messages.push({ role: 'assistant', content: finalContent });
          const toolNames = processedCalls.map(t => t.function.name).join(', ');
          startAnim('*Running tools', ' (' + toolNames + ')*');

          // strip tool brackets from display
          let displayContent = finalContent;
          for (const toolCall of processedCalls) {
            const args = toolCall.args;
            const name = toolCall.function.name;
            // Step tracking
            if (_planSteps) {
              _currentStep = Math.min(_currentStep + 1, _planSteps);
              const stepEl = document.getElementById('plan-step-progress');
              if (stepEl) stepEl.textContent = _currentStep + '/' + _planSteps;
              const aiMsg = document.querySelector('.chat-msg.ai:last-child');
              if (aiMsg) {
                const sd = document.createElement('div');
                sd.className = 'agent-step';
                sd.innerHTML = '<span class="agent-step-num">Step ' + _currentStep + '/' + _planSteps + '</span> <span class="agent-step-name">' + formatToolActivity(name, args) + '</span><span class="agent-step-bar"><span class="agent-step-progress" style="width:' + (_currentStep / _planSteps * 100) + '%"></span></span>';
                aiMsg.appendChild(sd);
              }
            }
            stopAnim('*' + formatToolActivity(name, args) + '*');
            let result;
            try {
              result = await executeToolCall(name, args);
            } catch (err) {
              result = 'Error: ' + err.message;
            }
            messages.push(getToolResultMsg(toolCall.id, name, String(result).slice(0, 500)));
            // Record action for loop detection
            loopDetector.recordAction({
              timestamp: Date.now(),
              agentId: 'main',
              type: loopDetector._inferActionType(name),
              tool: name,
              args: args,
              result: String(result).slice(0, 500),
              resultHash: loopDetector._fingerprintResult(String(result).slice(0, 500)),
              success: !String(result).startsWith('Error:'),
              errorFingerprint: String(result).startsWith('Error:') ? loopDetector._fingerprintError(String(result)) : null,
            });
            // Audit trail
            if (_planSteps) {
              chatHistory.push({ role: 'system', content: '[Step ' + _currentStep + '/' + _planSteps + '] Executed: ' + formatToolActivity(name, args) + '\nResult: ' + String(result).slice(0, 500) });
            }
            const bracketStr = '[' + name + ': ' + toolCall.function.arguments + ']';
            displayContent = displayContent.replace(bracketStr, '');
            if (toolCall._raw) {
              displayContent = displayContent.replace(toolCall._raw, '');
            }
            startAnim('*Running tools', ' (' + toolNames + ')*');
            resetRequestTimeout(timeoutMinutes, onTimeout);
          }
          stopAnim();
          // Loop detection analysis (text-parse path)
          if (_ldSettings.enabled !== false) {
            const loopAnalysis = loopDetector.analyze();
            if (loopAnalysis.status === 'possible' && _ldSettings.showPossibleWarning !== false) {
              updateLoopIndicator('possible', loopAnalysis);
            } else if (loopAnalysis.status === 'confirmed' || loopAnalysis.status === 'critical') {
              const shouldStop = await handleLoopDetection(loopAnalysis);
              if (shouldStop) break;
            }
          }
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
        await saveSession();
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
      const pushMsg = { role: 'assistant', content: responseContent, model: providerId };
      if (_lastReasoningContent) pushMsg.reasoning_content = _lastReasoningContent;
      chatHistory.push(pushMsg);
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
      // Render diff view if there are file changes
      if (typeof DiffView !== 'undefined') {
        const diffHtml = DiffView.render();
        if (diffHtml) {
          const _chatContainer = document.getElementById('chat-messages');
          const _lastMsg = _chatContainer.lastElementChild;
          if (_lastMsg && _lastMsg.classList.contains('ai')) {
            const _wrapper = document.createElement('div');
            _wrapper.innerHTML = diffHtml;
            _lastMsg.appendChild(_wrapper.firstElementChild);
            _chatContainer.scrollTop = _chatContainer.scrollHeight;
          }
        }
      }
      // Background summary for long conversations — fire-and-forget
      const _finalTotalChars = chatHistory.reduce((sum, m) => sum + (m.content || '').length, 0);
      if (chatHistory.length > 15 || _finalTotalChars > 30000) summarizeChat();
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
    else if (/^5\d\d/.test(msg) || /500|502|503|504/.test(msg)) displayMsg = msg + ' \u2014 Server error. Retrying automatically...';
    else if (/Failed to fetch/.test(msg)) displayMsg = 'Network error \u2014 check your connection and the API endpoint URL in settings.';
    contentDiv.textContent = 'Error: ' + displayMsg;
    logToTerminal('AI request failed: ' + displayMsg, 'error');
    if (_taskRouted && err.message && !/Stopped by user|Timed out/i.test(err.message)) {
      const fallback = TaskRouter.handleFailure(_taskClassification.primary, providerId, err);
      if (fallback.action === 'fallback') {
        TaskRouter.showFallbackToast(fallback.message, () => {
          TaskRouter.setTaskModel(_taskClassification.primary, fallback.providerId, fallback.model);
          input.value = text;
          sendMessage(text);
        }, () => {
          TaskRouter._disabledTasks[_taskClassification.primary] = { model: providerId, reason: err.message };
          TaskRouter._save();
          TaskRouter.renderSettings();
        });
      } else if (fallback.action === 'disable') {
        TaskRouter.showFallbackToast(fallback.message, null, () => {
          TaskRouter._disabledTasks[_taskClassification.primary] = { model: providerId, reason: err.message };
          TaskRouter._save();
          TaskRouter.renderSettings();
        });
      }
    }
  } finally {
    clearActivity();
    if (VisionSession.active) VisionSession.revoke('answer');
    _isRequestActive = false;
    if (_requestAborter === _currentAborter) _requestAborter = null;
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
  showModal('search-modal');
  document.getElementById('search-input').value = '';
  document.getElementById('search-results').innerHTML = '<div style="color:var(--text3);padding:1rem;text-align:center;">Type a query and press Enter to search</div>';
  setTimeout(() => document.getElementById('search-input').focus(), 100);
});

document.getElementById('btn-close-search').addEventListener('click', () => {
  hideModal('search-modal');
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
  const wasHidden = panel.classList.contains('hidden');
  if (wasHidden) {
    document.getElementById('docker-panel')?.classList.add('hidden');
    document.getElementById('btn-docker-toggle')?.classList.remove('active');
  }
  panel.classList.toggle('hidden');
  document.getElementById('btn-terminal-toggle').classList.toggle('active');
  if (!panel.classList.contains('hidden') && typeof TerminalManager !== 'undefined') {
    const t = TerminalManager._terminals[TerminalManager._activeTerminalId];
    if (t) setTimeout(() => { try { t.fitAddon.fit(); } catch(e) {} }, 50);
  }
});

document.getElementById('btn-terminal-clear').addEventListener('click', () => {
  document.getElementById('terminal-output').innerHTML = '';
});

// ==================== THEME TOGGLE ====================

const THEME_CYCLE = ['dark', 'light', 'high-contrast', 'solarized-dark', 'solarized-light'];

document.getElementById('btn-theme-toggle').addEventListener('click', () => {
  const idx = THEME_CYCLE.indexOf(currentTheme);
  currentTheme = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
  document.getElementById('settings-theme').value = currentTheme;
  applyTheme();
  saveSettingsToDisk({ theme: currentTheme });
  logToTerminal(`Switched to ${currentTheme} theme`, 'info');
});

document.getElementById('btn-fullscreen').addEventListener('click', () => toggleFullscreen());

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

const DEFAULT_SHORTCUTS = {
  saveFile: { label: 'Save current file', keys: 'Ctrl+S', ctrl: true, key: 's', shift: false, alt: false, fn: () => saveCurrentFile() },
  newFile: { label: 'New file', keys: 'Ctrl+N', ctrl: true, key: 'n', shift: false, alt: false, fn: () => { const name = prompt('File name:'); if (name) { tabContents[name] = ''; tabLanguages[name] = detectLanguage(name); tabDirty[name] = true; openTabs.push(name); switchTab(openTabs.length - 1); renderFileTree(); } } },
  closeTab: { label: 'Close current tab', keys: 'Ctrl+W', ctrl: true, key: 'w', shift: false, alt: false, fn: () => { if (activeTabIndex >= 0) closeTab(activeTabIndex); } },
  commandPalette: { label: 'Command palette', keys: 'Ctrl+Shift+O', ctrl: true, key: 'o', shift: true, alt: false, fn: () => { if (typeof CommandPalette !== 'undefined') CommandPalette.show(); } },
  smartSearch: {
    label: 'Smart search (all)',
    keys: 'Ctrl+Shift+P', ctrl: true, shift: true, key: 'p',
    fn: () => { if (currentProject) SmartSearch.open(); }
  },
  searchFiles: { label: 'Search in files', keys: 'Ctrl+Shift+F', ctrl: true, key: 'f', shift: true, alt: false, fn: () => { document.getElementById('btn-search-toggle').click(); } },
  toggleSidebar: { label: 'Toggle sidebar', keys: 'Ctrl+B', ctrl: true, key: 'b', shift: false, alt: false, fn: () => { const sb = document.getElementById('sidebar'); const resizer = document.getElementById('sidebar-resizer'); sb.classList.toggle('hidden'); if (resizer) resizer.classList.toggle('hidden'); localStorage.setItem('florde-sidebar-hidden', sb.classList.contains('hidden') ? '1' : '0'); } },
  nextTab: { label: 'Next tab', keys: 'Ctrl+Tab', ctrl: true, key: 'Tab', shift: false, alt: false, fn: () => { if (openTabs.length > 1) { const next = (activeTabIndex + 1 + openTabs.length) % openTabs.length; switchTab(next); } } },
  prevTab: { label: 'Previous tab', keys: 'Ctrl+Shift+Tab', ctrl: true, key: 'Tab', shift: true, alt: false, fn: () => { if (openTabs.length > 1) { const prev = (activeTabIndex - 1 + openTabs.length) % openTabs.length; switchTab(prev); } } },
  toggleTerminal: { label: 'Toggle terminal', keys: 'Ctrl+`', ctrl: true, key: '`', shift: false, alt: false, fn: () => { document.getElementById('btn-terminal-toggle').click(); } },
  toggleBrowser: { label: 'Toggle browser', keys: 'Ctrl+Shift+B', ctrl: true, key: 'b', shift: true, alt: false, fn: () => { document.getElementById('btn-browser-toggle').click(); } },
  toggleDocker: { label: 'Toggle Docker panel', keys: 'Ctrl+Shift+D', ctrl: true, key: 'D', shift: true, alt: false, fn: () => { document.getElementById('btn-docker-toggle')?.click(); } },
  quickOpen: { label: 'Quick file open', keys: 'Ctrl+P', ctrl: true, key: 'p', shift: false, alt: false, fn: () => { if (currentProject) showQuickOpen(); } },
  showHelp: { label: 'Toggle shortcuts help', keys: '?', ctrl: false, key: '?', shift: false, alt: false, fn: () => { renderHelpShortcuts(); document.getElementById('help-modal').classList.toggle('hidden'); } },
};

function getShortcuts() {
  return { ...DEFAULT_SHORTCUTS };
}

function shortcutMatch(e, s) {
  if (s.key === '?') {
    if (e.key !== '?' || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return false;
    if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return false;
    return true;
  }
  return (e.ctrlKey || e.metaKey) === s.ctrl && e.key.toLowerCase() === s.key.toLowerCase() && e.shiftKey === s.shift && e.altKey === s.alt;
}

document.addEventListener('keydown', (e) => {
  const bindings = typeof KeybindManager !== 'undefined' ? KeybindManager.getBindings() : [];
  const combo = [];
  if (e.ctrlKey || e.metaKey) combo.push('Ctrl');
  if (e.shiftKey) combo.push('Shift');
  if (e.altKey) combo.push('Alt');
  combo.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
  const pressed = combo.join('+');
  for (const b of bindings) {
    if (b.keys === pressed) {
      const sc = DEFAULT_SHORTCUTS[b.id];
      if (sc) { e.preventDefault(); sc.fn(); return; }
      const cmd = typeof COMMAND_REGISTRY !== 'undefined' ? COMMAND_REGISTRY[b.id] : null;
      if (cmd) { e.preventDefault(); cmd.fn(); return; }
    }
  }
  const shortcuts = getShortcuts();
  for (const [id, s] of Object.entries(shortcuts)) {
    if (bindings.find(b => b.id === id)) continue;
    if (shortcutMatch(e, s)) {
      e.preventDefault();
      s.fn();
      return;
    }
  }
});

function renderHelpShortcuts() {
  const container = document.getElementById('help-shortcuts-list');
  if (!container) return;
  const shortcuts = getShortcuts();
  container.innerHTML = Object.entries(shortcuts).map(([id, s]) =>
    `<div class="shortcut-row"><kbd>${s.keys}</kbd> <span>${s.label}</span></div>`
  ).join('');
  container.insertAdjacentHTML('beforeend', '<div class="shortcut-row"><kbd>Enter</kbd> <span>Send chat message</span></div><div class="shortcut-row"><kbd>Shift+Enter</kbd> <span>New line in chat</span></div>');
}

function renderKeybindings() {
  const container = document.getElementById('keybindings-list');
  if (!container) return;
  const shortcuts = typeof getShortcuts === 'function' ? getShortcuts() : {};
  const registry = typeof COMMAND_REGISTRY !== 'undefined' ? COMMAND_REGISTRY : {};
  const bindings = typeof KeybindManager !== 'undefined' ? KeybindManager.getBindings() : [];

  const allItems = [];
  for (const [id, s] of Object.entries(shortcuts)) {
    const custom = bindings.find(b => b.id === id);
    allItems.push({ id, label: s.label, category: 'General', keys: custom ? custom.keys : s.keys, isCustom: !!custom });
  }
  for (const [id, c] of Object.entries(registry)) {
    if (!shortcuts[id]) {
      const custom = bindings.find(b => b.id === id);
      allItems.push({ id, label: c.label, category: c.category || 'Commands', keys: custom ? custom.keys : '', isCustom: !!custom });
    }
  }

  allItems.sort((a, b) => {
    if (a.category < b.category) return -1;
    if (a.category > b.category) return 1;
    return a.label.localeCompare(b.label);
  });

  let html = '';
  let lastCat = '';
  for (const item of allItems) {
    if (item.category !== lastCat) {
      html += '<div style="font-weight:600;color:var(--text2);font-size:0.8rem;margin:0.8rem 0 0.3rem;text-transform:uppercase;">' + item.category + '</div>';
      lastCat = item.category;
    }
    html += '<div class="keybinding-row" data-id="' + item.id + '" style="display:flex;align-items:center;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid var(--border);cursor:pointer;">';
    html += '<span style="font-size:0.85rem;">' + item.label + '</span>';
    html += '<div style="display:flex;align-items:center;gap:0.4rem;">';
    html += '<kbd style="background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:0.2rem 0.5rem;font-size:0.8rem;color:var(--text2);min-width:60px;text-align:center;">' + (item.keys || '—') + '</kbd>';
    if (item.isCustom) html += '<button class="keybinding-reset-btn" data-id="' + item.id + '" title="Reset" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:0.9rem;">↺</button>';
    html += '</div></div>';
  }
  container.innerHTML = html;

  container.querySelectorAll('.keybinding-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.keybinding-reset-btn')) return;
      const id = row.dataset.id;
      const kbd = row.querySelector('kbd');
      const prevText = kbd.textContent;
      kbd.textContent = 'Press key...';
      kbd.style.borderColor = 'var(--accent)';
      kbd.style.color = 'var(--text)';
      const handler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') {
          kbd.textContent = prevText;
          kbd.style.borderColor = '';
          kbd.style.color = '';
          document.removeEventListener('keydown', handler);
          return;
        }
        const parts = [];
        if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
        if (e.shiftKey) parts.push('Shift');
        if (e.altKey) parts.push('Alt');
        let key = e.key;
        if (key === ' ') key = 'Space';
        else if (key.length === 1) key = key.toUpperCase();
        parts.push(key);
        const combo = parts.join('+');
        KeybindManager.setBinding(id, combo);
        kbd.textContent = combo;
        kbd.style.borderColor = '';
        kbd.style.color = '';
        document.removeEventListener('keydown', handler);
        const resetBtn = row.querySelector('.keybinding-reset-btn');
        if (!resetBtn) {
          const div = row.querySelector('div:last-child');
          const btn = document.createElement('button');
          btn.className = 'keybinding-reset-btn';
          btn.dataset.id = id;
          btn.title = 'Reset';
          btn.style.cssText = 'background:none;border:none;color:var(--text3);cursor:pointer;font-size:0.9rem;';
          btn.textContent = '↺';
          btn.addEventListener('click', (e2) => {
            e2.stopPropagation();
            KeybindManager.resetBinding(id);
            const sc = shortcuts[id];
            kbd.textContent = sc ? sc.keys : '—';
            btn.remove();
          });
          div.appendChild(btn);
        }
      };
      document.addEventListener('keydown', handler);
      setTimeout(() => {
        kbd.textContent = prevText;
        kbd.style.borderColor = '';
        kbd.style.color = '';
        document.removeEventListener('keydown', handler);
      }, 5000);
    });
  });

  container.querySelectorAll('.keybinding-reset-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      KeybindManager.resetBinding(id);
      const row = btn.closest('.keybinding-row');
      const kbd = row.querySelector('kbd');
      const sc = shortcuts[id];
      kbd.textContent = sc ? sc.keys : '—';
      btn.remove();
    });
  });

  document.getElementById('btn-reset-keybindings')?.addEventListener('click', () => {
    if (confirm('Reset all keyboard shortcuts?')) {
      KeybindManager.resetAll();
      renderKeybindings();
    }
  }, { once: true });
}
document.getElementById('btn-close-help').addEventListener('click', () => {
  document.getElementById('help-modal').classList.add('hidden');
});

// ==================== SETTINGS MODAL ====================

document.getElementById('btn-settings').addEventListener('click', () => {
  hideAllModals();
  showModal('settings-modal');
});

document.getElementById('btn-close-settings').addEventListener('click', () => {
  hideModal('settings-modal');
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
    if (tab.dataset.tab === 'mcp') {
      renderMcpServers();
    }
    if (tab.dataset.tab === 'keybindings') {
      renderKeybindings();
    }
    if (tab.dataset.tab === 'api-keys') {
      if (typeof ApiKeyManager !== 'undefined') ApiKeyManager.render(document.getElementById('api-keys-list'));
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

// Provider search filter
document.getElementById('provider-search')?.addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  document.querySelectorAll('.provider-group').forEach(group => {
    const header = group.querySelector('.provider-header');
    if (!header) return;
    const name = header.textContent.toLowerCase();
    const id = (header.dataset.provider || '').toLowerCase();
    group.style.display = (!q || name.includes(q) || id.includes(q)) ? '' : 'none';
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
  { id: 'stripe', name: 'Stripe', icon: '💳', desc: 'Payments, subscriptions, invoices & billing', baseUrl: 'https://api.stripe.com/v1', authType: 'Bearer', tokenLabel: 'Stripe Secret Key', tokenHelp: 'Find at dashboard.stripe.com > Developers > API keys. Use the secret key (sk_live_... or sk_test_...). Never share your secret key.' },
  { id: 'slack', name: 'Slack', icon: '💬', desc: 'Messaging, channels, files & workplace collaboration', baseUrl: 'https://slack.com/api', authType: 'Bearer', tokenLabel: 'Slack User/App Token', tokenHelp: 'Create at api.slack.com > Apps > Your App > OAuth & Permissions. Needs scopes: channels:read, chat:write, files:read, users:read.' },
  { id: 'notion', name: 'Notion', icon: '📝', desc: 'Pages, databases, comments & search', baseUrl: 'https://api.notion.com/v1', authType: 'Bearer', tokenLabel: 'Notion Internal Integration Token', tokenHelp: 'Create at notion.so/my-integrations. Must be added to workspace and granted page/database access.' },
  { id: 'googledrive', name: 'Google Drive', icon: '📁', desc: 'Files, folders, docs & cloud storage', baseUrl: 'https://www.googleapis.com/drive/v3', authType: 'Bearer', tokenLabel: 'Google OAuth 2.0 Access Token', tokenHelp: 'Get from Google Cloud Console > APIs & Services > Credentials. Requires Drive API enabled. Use OAuth 2.0 with scopes: drive.readonly or drive.file.' },
  { id: 'linear', name: 'Linear', icon: '📋', desc: 'Issue tracking, sprints, roadmaps & projects', baseUrl: 'https://api.linear.app/graphql', authType: 'Bearer', tokenLabel: 'Linear API Key', tokenHelp: 'Generate at linear.app > Settings > API > Personal API Key. No additional scopes needed.' },
  { id: 'sentry', name: 'Sentry', icon: '🐛', desc: 'Error tracking, performance monitoring & releases', baseUrl: 'https://sentry.io/api/0', authType: 'Bearer', tokenLabel: 'Sentry Auth Token', tokenHelp: 'Create at sentry.io > Settings > Developer Settings > Auth Tokens. Needs scopes: project:read, event:read, event:write, org:read.' },
  { id: 'datadog', name: 'Datadog', icon: '📊', desc: 'Infrastructure monitoring, logs, APM & dashboards', baseUrl: 'https://api.datadoghq.com/api/v1', authType: 'Bearer', tokenLabel: 'Datadog API + App Key', tokenHelp: 'Find at app.datadoghq.com > Organization Settings > API Keys. Also needs an Application Key from the same page. Format: api_key:app_key' },
  { id: 'openai', name: 'OpenAI', icon: '🧠', desc: 'GPT models, embeddings, assistants & fine-tuning', baseUrl: 'https://api.openai.com/v1', authType: 'Bearer', tokenLabel: 'OpenAI API Key', tokenHelp: 'Generate at platform.openai.com > API Keys. Can also be used as a secondary AI provider alongside the app providers.' },
  { id: 'anthropic', name: 'Anthropic', icon: '🌿', desc: 'Claude models, messages API & tool use', baseUrl: 'https://api.anthropic.com/v1', authType: 'Bearer', tokenLabel: 'Anthropic API Key', tokenHelp: 'Get from console.anthropic.com > API Keys. Can also be used as a secondary AI provider alongside the app providers.' },
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
  },
  stripe: {
    auth: 'Bearer', baseUrl: 'https://api.stripe.com/v1',
    desc: 'Stripe payments & billing platform',
    tools: [
      { n: 'list_charges', d: 'List recent charges/payments', m: 'GET', p: '/charges', ps: { limit: { t: 'number', d: 'Max results (1-100)' }, customer: { t: 'string', d: 'Filter by customer ID' } }, r: [] },
      { n: 'create_payment_intent', d: 'Create a payment intent', m: 'POST', p: '/payment_intents', ps: { amount: { t: 'number', d: 'Amount in cents' }, currency: { t: 'string', d: 'Currency code (usd, eur)' }, customer: { t: 'string', d: 'Customer ID (optional)' }, description: { t: 'string', d: 'Description' } }, r: ['amount', 'currency'] },
      { n: 'list_customers', d: 'List customers', m: 'GET', p: '/customers', ps: { limit: { t: 'number', d: 'Max results' }, email: { t: 'string', d: 'Filter by email' } }, r: [] },
      { n: 'create_customer', d: 'Create a customer', m: 'POST', p: '/customers', ps: { email: { t: 'string', d: 'Customer email' }, name: { t: 'string', d: 'Customer name' }, description: { t: 'string', d: 'Description' } }, r: ['email'] },
      { n: 'list_subscriptions', d: 'List subscriptions', m: 'GET', p: '/subscriptions', ps: { limit: { t: 'number', d: 'Max results' }, customer: { t: 'string', d: 'Filter by customer ID' }, status: { t: 'string', d: 'all|active|canceled|incomplete|past_due|trialing' } }, r: [] },
      { n: 'create_subscription', d: 'Create a subscription', m: 'POST', p: '/subscriptions', ps: { customer: { t: 'string', d: 'Customer ID' }, items: { t: 'array', d: 'Price items [{price: "price_xxx"}]', it: { t: 'object' } }, trial_period_days: { t: 'number', d: 'Trial period in days' } }, r: ['customer', 'items'] },
      { n: 'list_invoices', d: 'List invoices', m: 'GET', p: '/invoices', ps: { limit: { t: 'number', d: 'Max results' }, customer: { t: 'string', d: 'Filter by customer ID' }, status: { t: 'string', d: 'draft|open|paid|uncollectible|void' } }, r: [] },
      { n: 'create_invoice', d: 'Create an invoice', m: 'POST', p: '/invoices', ps: { customer: { t: 'string', d: 'Customer ID' }, collection_method: { t: 'string', d: 'charge_automatically|send_invoice' }, days_until_due: { t: 'number', d: 'Due days for send_invoice' } }, r: ['customer'] },
      { n: 'get_balance', d: 'Get account balance', m: 'GET', p: '/balance', ps: {}, r: [] },
      { n: 'list_products', d: 'List products', m: 'GET', p: '/products', ps: { limit: { t: 'number', d: 'Max results' }, active: { t: 'boolean', d: 'Only active products' } }, r: [] },
      { n: 'create_product', d: 'Create a product', m: 'POST', p: '/products', ps: { name: { t: 'string', d: 'Product name' }, description: { t: 'string', d: 'Description' }, active: { t: 'boolean', d: 'Whether active' } }, r: ['name'] },
    ]
  },
  slack: {
    auth: 'Bearer', baseUrl: 'https://slack.com/api',
    desc: 'Slack workplace messaging & collaboration',
    tools: [
      { n: 'list_channels', d: 'List public channels', m: 'GET', p: '/conversations.list', ps: { limit: { t: 'number', d: 'Max results' }, types: { t: 'string', d: 'public_channel,private_channel' } }, r: [] },
      { n: 'post_message', d: 'Send a message to a channel', m: 'POST', p: '/chat.postMessage', ps: { channel: { t: 'string', d: 'Channel ID or name' }, text: { t: 'string', d: 'Message text' }, as_user: { t: 'boolean', d: 'Post as the authenticated user' } }, r: ['channel', 'text'] },
      { n: 'create_channel', d: 'Create a public channel', m: 'POST', p: '/conversations.create', ps: { name: { t: 'string', d: 'Channel name (no spaces)' }, is_private: { t: 'boolean', d: 'Private channel' } }, r: ['name'] },
      { n: 'get_channel_info', d: 'Get channel information', m: 'GET', p: '/conversations.info', ps: { channel: { t: 'string', d: 'Channel ID' } }, r: ['channel'] },
      { n: 'list_users', d: 'List workspace users', m: 'GET', p: '/users.list', ps: { limit: { t: 'number', d: 'Max results' } }, r: [] },
      { n: 'get_user_info', d: 'Get user information', m: 'GET', p: '/users.info', ps: { user: { t: 'string', d: 'User ID' } }, r: ['user'] },
      { n: 'list_files', d: 'List shared files', m: 'GET', p: '/files.list', ps: { channel: { t: 'string', d: 'Filter by channel' }, limit: { t: 'number', d: 'Max results' } }, r: [] },
      { n: 'search_messages', d: 'Search messages (Slack search syntax)', m: 'GET', p: '/search.messages', ps: { query: { t: 'string', d: 'Search query' }, count: { t: 'number', d: 'Results count' } }, r: ['query'] },
    ]
  },
  notion: {
    auth: 'Bearer', baseUrl: 'https://api.notion.com/v1',
    desc: 'Notion workspace, pages & databases',
    tools: [
      { n: 'get_page', d: 'Get page content', m: 'GET', p: '/pages/{pageId}', ps: { pageId: { t: 'string', d: 'Page UUID' } }, r: ['pageId'] },
      { n: 'create_page', d: 'Create a new page', m: 'POST', p: '/pages', ps: { parent: { t: 'object', d: 'Parent {type:"page_id"|"database_id", page_id/database_id: "..."}' }, properties: { t: 'object', d: 'Page properties' }, children: { t: 'array', d: 'Block children (optional)' } }, r: ['parent', 'properties'] },
      { n: 'update_page', d: 'Update page properties', m: 'PATCH', p: '/pages/{pageId}', ps: { pageId: { t: 'string', d: 'Page UUID' }, properties: { t: 'object', d: 'Properties to update' } }, r: ['pageId', 'properties'] },
      { n: 'list_databases', d: 'List accessible databases', m: 'GET', p: '/databases', ps: {}, r: [] },
      { n: 'get_database', d: 'Get database schema', m: 'GET', p: '/databases/{databaseId}', ps: { databaseId: { t: 'string', d: 'Database UUID' } }, r: ['databaseId'] },
      { n: 'query_database', d: 'Query a database', m: 'POST', p: '/databases/{databaseId}/query', ps: { databaseId: { t: 'string', d: 'Database UUID' }, filter: { t: 'object', d: 'Filter conditions' }, sorts: { t: 'array', d: 'Sort definitions' }, page_size: { t: 'number', d: 'Results per page' } }, r: ['databaseId'] },
      { n: 'search', d: 'Search Notion workspace', m: 'POST', p: '/search', ps: { query: { t: 'string', d: 'Search query' }, sort: { t: 'object', d: 'Sort options' }, page_size: { t: 'number', d: 'Results per page' } }, r: ['query'] },
      { n: 'get_block', d: 'Get content block', m: 'GET', p: '/blocks/{blockId}', ps: { blockId: { t: 'string', d: 'Block UUID' } }, r: ['blockId'] },
      { n: 'append_blocks', d: 'Append block children', m: 'PATCH', p: '/blocks/{blockId}/children', ps: { blockId: { t: 'string', d: 'Parent block UUID' }, children: { t: 'array', d: 'Blocks to append' } }, r: ['blockId', 'children'] },
    ]
  },
  googledrive: {
    auth: 'Bearer', baseUrl: 'https://www.googleapis.com/drive/v3',
    desc: 'Google Drive file storage & docs',
    tools: [
      { n: 'list_files', d: 'List files and folders', m: 'GET', p: '/files', ps: { q: { t: 'string', d: 'Search query' }, pageSize: { t: 'number', d: 'Results per page' }, orderBy: { t: 'string', d: 'modifiedTime desc|name|createdTime' } }, r: [] },
      { n: 'get_file', d: 'Get file metadata', m: 'GET', p: '/files/{fileId}', ps: { fileId: { t: 'string', d: 'File ID' } }, r: ['fileId'] },
      { n: 'create_folder', d: 'Create a folder', m: 'POST', p: '/files', ps: { name: { t: 'string', d: 'Folder name' }, parents: { t: 'array', d: 'Parent folder IDs (optional)', it: { t: 'string' } } }, r: ['name'] },
      { n: 'search_files', d: 'Search for files by name/content', m: 'GET', p: '/files', ps: { query: { t: 'string', d: 'Search text' }, pageSize: { t: 'number', d: 'Results per page' } }, r: ['query'] },
      { n: 'export_file', d: 'Export file in alternative format', m: 'GET', p: '/files/{fileId}/export', ps: { fileId: { t: 'string', d: 'File ID' }, mimeType: { t: 'string', d: 'Target MIME type (text/plain, application/pdf)' } }, r: ['fileId', 'mimeType'] },
    ]
  },
  linear: {
    auth: 'Bearer', baseUrl: 'https://api.linear.app/graphql',
    desc: 'Linear issue tracking & project management',
    tools: [
      { n: 'list_issues', d: 'List issues', m: 'POST', p: '/graphql', ps: { teamId: { t: 'string', d: 'Team ID (optional)' }, assigneeId: { t: 'string', d: 'Assignee ID (optional)' }, status: { t: 'string', d: 'Filter by status (optional)' } }, r: [], isGraphQL: true, gql: 'query($teamId:String,$assigneeId:String){issues(filter:{team:{id:{eq:$teamId}}}){nodes{id title description state{name} priority assignee{id name}}}}' },
      { n: 'create_issue', d: 'Create an issue', m: 'POST', p: '/graphql', ps: { teamId: { t: 'string', d: 'Team ID' }, title: { t: 'string', d: 'Issue title' }, description: { t: 'string', d: 'Issue description' }, priority: { t: 'number', d: '0=none,1=urgent,2=high,3=medium,4=low' }, assigneeId: { t: 'string', d: 'Assignee ID (optional)' } }, r: ['teamId', 'title'], isGraphQL: true, gql: 'mutation($teamId:String!,$title:String!,$description:String,$priority:Float){issueCreate(input:{teamId:$teamId,title:$title,description:$description,priority:$priority}){success issue{id title}} }', gqlVars: ['teamId', 'title', 'description', 'priority'] },
      { n: 'update_issue', d: 'Update an issue', m: 'POST', p: '/graphql', ps: { issueId: { t: 'string', d: 'Issue ID' }, title: { t: 'string', d: 'New title (optional)' }, description: { t: 'string', d: 'New description (optional)' }, stateId: { t: 'string', d: 'New status ID (optional)' }, priority: { t: 'number', d: 'New priority (optional)' } }, r: ['issueId'], isGraphQL: true, gql: 'mutation($issueId:String!,$title:String,$description:String,$stateId:String,$priority:Float){issueUpdate(id:$issueId,input:{title:$title,description:$description,stateId:$stateId,priority:$priority}){success}}', gqlVars: ['issueId', 'title', 'description', 'stateId', 'priority'] },
      { n: 'list_teams', d: 'List teams', m: 'POST', p: '/graphql', ps: {}, r: [], isGraphQL: true, gql: 'query{teams{nodes{id name key description memberCount}} }' },
      { n: 'list_projects', d: 'List projects', m: 'POST', p: '/graphql', ps: {}, r: [], isGraphQL: true, gql: 'query{projects{nodes{id name description state status}} }' },
      { n: 'get_user', d: 'Get current user info', m: 'POST', p: '/graphql', ps: {}, r: [], isGraphQL: true, gql: 'query{viewer{id name email}}' },
    ]
  },
  sentry: {
    auth: 'Bearer', baseUrl: 'https://sentry.io/api/0',
    desc: 'Sentry error tracking & performance monitoring',
    tools: [
      { n: 'list_projects', d: 'List organization projects', m: 'GET', p: '/projects/', ps: {}, r: [] },
      { n: 'list_issues', d: 'List issues for a project', m: 'GET', p: '/projects/{orgSlug}/{projectSlug}/issues/', ps: { orgSlug: { t: 'string', d: 'Organization slug' }, projectSlug: { t: 'string', d: 'Project slug' }, statsPeriod: { t: 'string', d: '24h|14d|30d' }, query: { t: 'string', d: 'Search query' } }, r: ['orgSlug', 'projectSlug'] },
      { n: 'get_issue', d: 'Get issue details with events', m: 'GET', p: '/issues/{issueId}/', ps: { issueId: { t: 'string', d: 'Issue ID' } }, r: ['issueId'] },
      { n: 'update_issue', d: 'Update issue status/assignment', m: 'PUT', p: '/issues/{issueId}/', ps: { issueId: { t: 'string', d: 'Issue ID' }, status: { t: 'string', d: 'resolved|unresolved|ignored' }, assignedTo: { t: 'string', d: 'Assignee username (optional)' }, isPublic: { t: 'boolean', d: 'Make issue publicly visible' } }, r: ['issueId', 'status'] },
      { n: 'list_events', d: 'List events for an issue', m: 'GET', p: '/issues/{issueId}/events/', ps: { issueId: { t: 'string', d: 'Issue ID' }, per_page: { t: 'number', d: 'Results per page' } }, r: ['issueId'] },
      { n: 'list_releases', d: 'List project releases', m: 'GET', p: '/projects/{orgSlug}/{projectSlug}/releases/', ps: { orgSlug: { t: 'string', d: 'Organization slug' }, projectSlug: { t: 'string', d: 'Project slug' } }, r: ['orgSlug', 'projectSlug'] },
      { n: 'create_release', d: 'Create a release', m: 'POST', p: '/projects/{orgSlug}/{projectSlug}/releases/', ps: { orgSlug: { t: 'string', d: 'Organization slug' }, projectSlug: { t: 'string', d: 'Project slug' }, version: { t: 'string', d: 'Release version string' }, ref: { t: 'string', d: 'Git commit ref (optional)' } }, r: ['orgSlug', 'projectSlug', 'version'] },
    ]
  },
  datadog: {
    auth: 'Bearer', baseUrl: 'https://api.datadoghq.com/api/v1',
    desc: 'Datadog infrastructure monitoring & APM',
    tools: [
      { n: 'list_monitors', d: 'List all monitors', m: 'GET', p: '/monitor', ps: { group: { t: 'string', d: 'Filter by group' }, name: { t: 'string', d: 'Filter by name' }, tags: { t: 'string', d: 'Comma-separated tags' } }, r: [] },
      { n: 'get_monitor', d: 'Get monitor details', m: 'GET', p: '/monitor/{monitorId}', ps: { monitorId: { t: 'number', d: 'Monitor ID' } }, r: ['monitorId'] },
      { n: 'create_monitor', d: 'Create a metric monitor', m: 'POST', p: '/monitor', ps: { type: { t: 'string', d: 'metric alert|service check|event alert|log alert|process alert' }, query: { t: 'string', d: 'Monitor query' }, name: { t: 'string', d: 'Monitor name' }, message: { t: 'string', d: 'Notification message' }, tags: { t: 'array', d: 'Tags', it: { t: 'string' } } }, r: ['type', 'query', 'name', 'message'] },
      { n: 'mute_monitor', d: 'Mute/unmute a monitor', m: 'POST', p: '/monitor/{monitorId}/mute', ps: { monitorId: { t: 'number', d: 'Monitor ID' } }, r: ['monitorId'] },
      { n: 'search_events', d: 'Search events stream', m: 'GET', p: '/events', ps: { start: { t: 'number', d: 'Start timestamp' }, end: { t: 'number', d: 'End timestamp' }, priority: { t: 'string', d: 'all|normal|low' }, tags: { t: 'string', d: 'Comma-separated tags' } }, r: [] },
      { n: 'list_dashboards', d: 'List all dashboards', m: 'GET', p: '/dashboard', ps: { filter: { t: 'string', d: 'Filter by name' } }, r: [] },
      { n: 'search_logs', d: 'Search logs (requires Datadog Logs)', m: 'POST', p: '/logs-queries/list', ps: { query: { t: 'string', d: 'Log search query' }, time: { t: 'object', d: 'Time range {from, to}' }, limit: { t: 'number', d: 'Results limit' } }, r: ['query'] },
      { n: 'list_hosts', d: 'List hosts reporting to Datadog', m: 'GET', p: '/hosts', ps: { filter: { t: 'string', d: 'Filter by hostname' } }, r: [] },
    ]
  },
  openai: {
    auth: 'Bearer', baseUrl: 'https://api.openai.com/v1',
    desc: 'OpenAI GPT models & API tools',
    tools: [
      { n: 'list_models', d: 'List available GPT models', m: 'GET', p: '/models', ps: {}, r: [] },
      { n: 'get_model', d: 'Get model details', m: 'GET', p: '/models/{modelId}', ps: { modelId: { t: 'string', d: 'Model ID (gpt-4o, gpt-4o-mini)' } }, r: ['modelId'] },
      { n: 'create_completion', d: 'Send a text completion request', m: 'POST', p: '/chat/completions', ps: { model: { t: 'string', d: 'Model to use' }, messages: { t: 'array', d: 'Chat messages [{role, content}]', it: { t: 'object' } }, temperature: { t: 'number', d: '0-2, creativity' }, max_tokens: { t: 'number', d: 'Max tokens to generate' } }, r: ['model', 'messages'] },
      { n: 'create_embedding', d: 'Create text embeddings', m: 'POST', p: '/embeddings', ps: { model: { t: 'string', d: 'text-embedding-3-small|text-embedding-3-large' }, input: { t: 'array', d: 'Text inputs to embed', it: { t: 'string' } } }, r: ['model', 'input'] },
      { n: 'list_assistants', d: 'List OpenAI assistants', m: 'GET', p: '/assistants', ps: { limit: { t: 'number', d: 'Max results' } }, r: [] },
      { n: 'create_assistant', d: 'Create a new assistant', m: 'POST', p: '/assistants', ps: { name: { t: 'string', d: 'Assistant name' }, instructions: { t: 'string', d: 'System instructions' }, model: { t: 'string', d: 'Model ID' }, tools: { t: 'array', d: 'Tool definitions [{type:"code_interpreter"}]', it: { t: 'object' } } }, r: ['name', 'instructions', 'model'] },
      { n: 'list_files', d: 'List uploaded files', m: 'GET', p: '/files', ps: { purpose: { t: 'string', d: 'assistants|fine-tune|vision' } }, r: [] },
      { n: 'upload_file', d: 'Upload a file for assistants/fine-tuning', m: 'POST', p: '/files', ps: { purpose: { t: 'string', d: 'assistants|fine-tune' }, content: { t: 'string', d: 'File content as string' } }, r: ['purpose', 'content'] },
    ]
  },
  anthropic: {
    auth: 'Bearer', baseUrl: 'https://api.anthropic.com/v1',
    desc: 'Anthropic Claude models & API',
    tools: [
      { n: 'list_models', d: 'List available Claude models', m: 'GET', p: '/models', ps: {}, r: [] },
      { n: 'get_model', d: 'Get model details', m: 'GET', p: '/models/{modelId}', ps: { modelId: { t: 'string', d: 'Model ID (claude-opus-4, claude-sonnet-4)' } }, r: ['modelId'] },
      { n: 'create_message', d: 'Send a message to Claude', m: 'POST', p: '/messages', ps: { model: { t: 'string', d: 'Claude model' }, messages: { t: 'array', d: 'Messages [{role, content}]', it: { t: 'object' } }, system: { t: 'string', d: 'System prompt (optional)' }, max_tokens: { t: 'number', d: 'Max tokens' }, temperature: { t: 'number', d: '0-1, creativity' } }, r: ['model', 'messages', 'max_tokens'] },
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
  showModal('app-connect-modal');
  setTimeout(() => document.getElementById('app-connect-key').focus(), 100);
}

function hideAppConnectDialog() {
  hideModal('app-connect-modal');
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
document.getElementById('settings-language').addEventListener('change', async () => {
  const lang = document.getElementById('settings-language').value;
  if (typeof I18n !== 'undefined') {
    await I18n.setLanguage(lang);
  }
  logToTerminal('Language changed to ' + lang, 'info');
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
      list.innerHTML = models.map(m =>
        '<div class="ollama-model-item" data-name="' + escapeHtml(m.name) + '">' +
          '<span class="ollama-model-name">' + escapeHtml(m.name) + '</span>' +
          '<button class="ollama-model-delete" data-name="' + escapeHtml(m.name) + '" title="Delete model">\uD83D\uDDD1\uFE0F</button>' +
        '</div>'
      ).join('') +
      '<div class="ollama-download-item">Download Model...</div>';
    }
    list.querySelectorAll('.ollama-model-item').forEach(item => {
      item.addEventListener('click', async (e) => {
        if (e.target.classList.contains('ollama-model-delete')) return;
        const name = item.dataset.name;
        document.getElementById('model-ollama').value = name;
        list.classList.add('hidden');
        // Show model info toast
        try {
          const url = (document.getElementById('url-ollama')?.value || 'http://localhost:11434').replace(/\/+$/, '');
          const r = await fetchWithTimeout(url + '/api/show', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
          }, 5000);
          const info = await r.json();
          const size = (info.size || 0) >= 1073741824 ? (info.size / 1073741824).toFixed(1) + ' GB' :
                       (info.size || 0) >= 1048576 ? (info.size / 1048576).toFixed(1) + ' MB' :
                       (info.size || 0) + ' bytes';
          const modified = info.modified_at ? new Date(info.modified_at).toLocaleDateString() : 'unknown';
          showNotification('info',
            name + ' \u2014 ' + size + ' \u2014 modified ' + modified +
            (info.details ? ' \u2014 ' + (info.details.parameter_size || '?') + ' params' : ''),
            '\uD83E\uDD16');
        } catch {}
      });
    });
    list.querySelectorAll('.ollama-model-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const name = btn.dataset.name;
        if (!confirm('Delete model "' + name + '"? This cannot be undone.')) return;
        try {
          const url = (document.getElementById('url-ollama')?.value || 'http://localhost:11434').replace(/\/+$/, '');
          await fetchWithTimeout(url + '/api/delete', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
          }, 10000);
          // Refresh list
          document.getElementById('btn-ollama-models').click();
          document.getElementById('btn-ollama-models').click();
        } catch (err) {
          alert('Delete failed: ' + err.message);
        }
      });
    });
    const downloadBtn = list.querySelector('.ollama-download-btn, .ollama-download-item');
    if (downloadBtn) downloadBtn.addEventListener('click', () => showOllamaDownloadModal());
  } catch (err) {
    list.innerHTML = '<div class="ollama-error">Cannot connect: ' + escapeHtml(err.message) + '</div>';
  }
});

function showOllamaDownloadModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '<div class="modal-content" style="max-width:500px;"><h2>Download Ollama Model</h2>' +
    '<div class="settings-form">' +
    '<label>Model Name</label>' +
    '<input type="text" id="ollama-dl-name" placeholder="llama3.2" />' +
    '<div style="position:relative;">' +
    '<input type="text" id="ollama-dl-search" placeholder="Search models..." style="width:100%;padding:0.4rem;border:1px solid var(--border);border-radius:4px;background:var(--bg3);color:var(--text);margin:0.5rem 0;box-sizing:border-box;" />' +
    '<div id="ollama-dl-search-results" class="ollama-search-results hidden"></div>' +
    '</div>' +
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
  // Search handler
  const searchInput = document.getElementById('ollama-dl-search');
  const searchResults = document.getElementById('ollama-dl-search-results');
  if (searchInput && searchResults) {
    let searchTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = searchInput.value.trim().toLowerCase();
      if (!q) { searchResults.classList.add('hidden'); return; }
      searchTimer = setTimeout(() => {
        const known = ['llama3.2','llama3.1','qwen2.5-coder','mistral','codestral','deepseek-coder-v2','phi3','gemma2','nomic-embed-text','llava','mixtral','command-r','dolphin-llama3','starling-lm','tinyllama','neural-chat'];
        const matches = known.filter(m => m.includes(q));
        if (matches.length > 0) {
          searchResults.innerHTML = matches.map(m => '<div class="ollama-search-item" data-name="' + m + '">' + m + '</div>').join('');
          searchResults.classList.remove('hidden');
          searchResults.querySelectorAll('.ollama-search-item').forEach(item => {
            item.addEventListener('click', () => {
              document.getElementById('ollama-dl-name').value = item.dataset.name;
              searchResults.classList.add('hidden');
            });
          });
        } else {
          searchResults.innerHTML = '<div class="ollama-search-item" style="color:var(--text3);">No matches found</div>';
          searchResults.classList.remove('hidden');
        }
      }, 300);
    });
    // Hide results on click outside
    document.addEventListener('click', (e) => {
      if (!searchResults?.isConnected) return;
      if (!e.target.closest('#ollama-dl-search, #ollama-dl-search-results')) {
        searchResults.classList.add('hidden');
      }
    }, { once: true });
  }
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

// Ollama live status check
async function checkOllamaStatus() {
  const el = document.getElementById('ollama-status');
  if (!el) return;
  el.className = 'ollama-status checking';
  try {
    const url = (document.getElementById('url-ollama')?.value || 'http://localhost:11434').replace(/\/+$/, '');
    await fetchWithTimeout(url + '/api/tags', { method: 'GET' }, 3000);
    el.className = 'ollama-status online';
  } catch {
    el.className = 'ollama-status offline';
  }
}
document.getElementById('url-ollama')?.addEventListener('change', checkOllamaStatus);
checkOllamaStatus();
function _isOllamaActive() {
  const { providerId, isRoute, route } = resolveProvider();
  if (isRoute) return route && route.provider === 'ollama';
  return providerId === 'ollama';
}
async function _conditionalOllamaCheck() {
  if (_isOllamaActive()) await checkOllamaStatus();
}
document.getElementById('provider-select')?.addEventListener('change', _conditionalOllamaCheck);
const _ollamaStatusTimer = setInterval(_conditionalOllamaCheck, 30000);

document.querySelectorAll('.layout-option input')?.forEach(radio => {
  radio.addEventListener('change', (e) => {
    if (!e.target.checked) return;
    const layout = e.target.value;
    document.body.className = document.body.className.replace(/layout-\S+/g, '').trim();
    document.body.classList.add('layout-' + layout);
    saveSettingsToDisk({ layout });
  });
});

document.getElementById('chat-font-size')?.addEventListener('input', (e) => {
  const size = e.target.value + 'px';
  document.documentElement.style.setProperty('--chat-font-size', size);
  document.getElementById('chat-font-size-label') && (document.getElementById('chat-font-size-label').textContent = size);
  saveSettingsToDisk({ chatFontSize: e.target.value });
});

document.getElementById('editor-font-size')?.addEventListener('input', (e) => {
  const size = e.target.value + 'px';
  document.documentElement.style.setProperty('--editor-font-size', size);
  document.getElementById('editor-font-size-label') && (document.getElementById('editor-font-size-label').textContent = size);
  if (editor) editor.updateOptions({ fontSize: parseInt(e.target.value) });
  saveSettingsToDisk({ editorFontSize: e.target.value });
});

// Auto-accept toggle
const autoAcceptToggle = document.querySelector('.settings-toggle[data-setting="auto-accept"]');
if (autoAcceptToggle) {
  autoAcceptToggle.addEventListener('click', () => {
    const checked = autoAcceptToggle.classList.contains('on');
    document.getElementById('auto-exceptions-area')?.classList.toggle('hidden', !checked);
    const permList = document.getElementById('permission-list');
    if (permList) {
      permList.style.opacity = checked ? '0.4' : '1';
      permList.style.pointerEvents = checked ? 'none' : '';
    }
    saveSettingsToDisk({ autoAccept: checked });
  });
}

// Auto-exception checkboxes
const allExcKeys = ['shell', 'outside', 'git', 'terminal', 'write_file', 'delete_file', 'web_search', 'web_fetch', 'browser', 'ask_question'];
allExcKeys.forEach(key => {
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
  const providerIds = ['openai','deepseek','mistral','anthropic','gemini','grok','opencodezen','opencodego','ollama','lmstudio','localai','openrouter','custom'];
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
  results.innerHTML = items.map(f => '<div class="qo-item" data-path="' + escapeHtml(f.path) + '">' +
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
      hideModal(m.id);
      const av = document.getElementById('app-view');
      if (av.classList.contains('hidden')) showStartMenu();
    }
  });
});

// Close modal-container on backdrop click
document.addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-container')) {
    hideModal('modal-container');
  }
});

// ==================== INIT ====================

// ==================== TAB GROUP MANAGER ====================

const TabGroupManager = {
  _groups: {},
  _activeGroup: null,
  _colors: ['#7c3aed', '#3b82f6', '#22c55e', '#ef4444', '#f59e0b', '#ec4899', '#14b8a6', '#f97316'],

  init() {
    this._load();
    this._render();
    document.getElementById('btn-add-tab-group')?.addEventListener('click', () => this._createGroup());
  },

  _load() {
    try { this._groups = JSON.parse(localStorage.getItem('florde-tab-groups')) || {}; } catch { this._groups = {}; }
  },

  _save() {
    localStorage.setItem('florde-tab-groups', JSON.stringify(this._groups));
  },

  _createGroup(name) {
    name = name || prompt('Group name:') || 'Group ' + Object.keys(this._groups).length;
    const color = this._colors[Object.keys(this._groups).length % this._colors.length];
    this._groups[name] = { name, color, tabs: [] };
    this._activeGroup = name;
    this._save();
    this._render();
  },

  addTab(groupName, tabName, tabData) {
    if (!this._groups[groupName]) return;
    if (!this._groups[groupName].tabs.find(t => t.name === tabName)) {
      this._groups[groupName].tabs.push({ name: tabName, ...tabData });
      this._save();
    }
  },

  removeTab(groupName, tabName) {
    if (!this._groups[groupName]) return;
    this._groups[groupName].tabs = this._groups[groupName].tabs.filter(t => t.name !== tabName);
    this._save();
    this._render();
  },

  removeGroup(name) {
    delete this._groups[name];
    if (this._activeGroup === name) this._activeGroup = Object.keys(this._groups)[0] || null;
    this._save();
    this._render();
  },

  getActiveGroup() { return this._activeGroup ? this._groups[this._activeGroup] : null; },
  getGroupTabs(name) { return this._groups[name]?.tabs || []; },

  _render() {
    const container = document.getElementById('tab-groups-container');
    if (!container) return;
    container.innerHTML = '';
    Object.keys(this._groups).forEach(name => {
      const g = this._groups[name];
      const el = document.createElement('div');
      el.className = 'tab-group' + (name === this._activeGroup ? ' active' : '');
      el.style.borderLeft = '3px solid ' + g.color;
      el.innerHTML = '<span>' + escapeHtml(g.name) + ' (' + g.tabs.length + ')</span><button class="tab-group-close" data-group="' + escapeHtml(name) + '">\u00d7</button>';
      el.addEventListener('click', (e) => { if (!e.target.classList.contains('tab-group-close')) { this._activeGroup = name; this._render(); this._applyFilter(); } });
      el.querySelector('.tab-group-close').addEventListener('click', (e) => { e.stopPropagation(); this.removeGroup(name); });
      container.appendChild(el);
    });
  },

  _applyFilter() {
    const dtabs = document.getElementById('diff-viewer-tabs');
    if (!dtabs) return;
    const group = this.getActiveGroup();
    Array.from(dtabs.children).forEach(tab => {
      const name = tab.dataset?.file || tab.textContent;
      if (!group) { tab.style.display = ''; return; }
      tab.style.display = group.tabs.find(t => t.name === name) ? '' : 'none';
    });
  }
};

// ==================== TO-DO LIST ====================

const TodoList = {
  _todos: [],
  _currentProject: null,
  _useDb: false,

  init() {
    document.getElementById('btn-todo-toggle')?.addEventListener('click', () => this.toggle());
    document.getElementById('btn-todo-close')?.addEventListener('click', () => this.hide());
    document.getElementById('todo-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.add();
    });
    document.getElementById('todo-filter')?.addEventListener('change', () => this.render());
    document.getElementById('btn-todo-clear-done')?.addEventListener('click', () => {
      this._todos = this._todos.filter(t => !t.done);
      this._save();
      this.render();
    });
  },

  setProject(name) {
    this._currentProject = name;
    this._load();
    this.render();
  },

  toggle() {
    const panel = document.getElementById('todo-panel');
    panel?.classList.toggle('hidden');
    if (!panel?.classList.contains('hidden')) this.render();
  },

  hide() {
    document.getElementById('todo-panel')?.classList.add('hidden');
  },

  async add() {
    const input = document.getElementById('todo-input');
    const text = input?.value.trim();
    if (!text) return;
    if (this._useDb) {
      const r = await window.electronAPI.flordeDb.run(this._currentProject,
        'INSERT INTO todos (text) VALUES (?)', [text]);
      if (r && r.lastInsertRowid) {
        this._todos.push({ id: r.lastInsertRowid, text, done: 0, createdAt: new Date().toISOString() });
      }
    } else {
      this._todos.push({ id: Date.now(), text, done: 0, createdAt: new Date().toISOString() });
    }
    this._save();
    this.render();
    if (input) input.value = '';
  },

  async toggleItem(id) {
    const item = this._todos.find(t => t.id === id);
    if (!item) return;
    item.done = item.done ? 0 : 1;
    if (this._useDb) {
      await window.electronAPI.flordeDb.run(this._currentProject,
        'UPDATE todos SET done = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [item.done, id]);
    }
    this._save();
    this.render();
  },

  async deleteItem(id) {
    this._todos = this._todos.filter(t => t.id !== id);
    if (this._useDb) {
      await window.electronAPI.flordeDb.run(this._currentProject,
        'DELETE FROM todos WHERE id = ?', [id]);
    }
    this._save();
    this.render();
  },

  async _load() {
    this._useDb = false;
    if (!this._currentProject) return;
    try {
      const hasDb = await window.electronAPI.flordeDir.check(this._currentProject);
      if (hasDb) {
        const rows = await window.electronAPI.flordeDb.query(this._currentProject,
          'SELECT * FROM todos ORDER BY created_at DESC');
        this._todos = rows || [];
        this._useDb = true;
        return;
      }
    } catch {}
    try {
      const key = 'florde-todos-' + this._currentProject;
      const data = localStorage.getItem(key);
      this._todos = data ? JSON.parse(data) : [];
    } catch { this._todos = []; }
  },

  _save() {
    if (!this._currentProject || this._useDb) return;
    localStorage.setItem('florde-todos-' + this._currentProject, JSON.stringify(this._todos));
  },

  render() {
    const container = document.getElementById('todo-list');
    if (!container) return;
    const filter = document.getElementById('todo-filter')?.value || 'all';
    let items = this._todos;
    if (filter === 'active') items = items.filter(t => !t.done);
    if (filter === 'done') items = items.filter(t => t.done);

    if (!items.length) {
      container.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text3);font-size:0.8rem;">No tasks</div>';
      return;
    }

    container.innerHTML = items.map(t => `
      <div class="todo-item ${t.done ? 'done' : ''}" data-id="${t.id}">
        <div class="todo-checkbox ${t.done ? 'checked' : ''}"></div>
        <span class="todo-item-text">${this._escapeHtml(t.text)}</span>
        <button class="todo-delete" data-id="${t.id}">&times;</button>
      </div>
    `).join('');

    container.querySelectorAll('.todo-checkbox').forEach(cb => {
      cb.addEventListener('click', () => this.toggleItem(parseInt(cb.parentElement.dataset.id)));
    });
    container.querySelectorAll('.todo-delete').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.deleteItem(parseInt(btn.dataset.id)); });
    });
  },

  _escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
};

// ==================== MARKDOWN NOTES ====================

const Notes = {
  _notes: {},
  _activeNote: null,
  _currentProject: null,
  _dirty: false,
  _previewMode: false,
  _useDb: false,

  init() {
    document.getElementById('btn-notes-toggle')?.addEventListener('click', () => this.toggle());
    document.getElementById('btn-notes-close')?.addEventListener('click', () => this.hide());
    document.getElementById('btn-notes-new')?.addEventListener('click', () => this.create());

    const editor = document.getElementById('notes-editor');
    editor?.addEventListener('input', () => { this._dirty = true; this.updatePreview(); });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && !document.getElementById('notes-panel')?.classList.contains('hidden')) {
        e.preventDefault(); this.save();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'M' && !document.getElementById('notes-panel')?.classList.contains('hidden')) {
        e.preventDefault(); this._previewMode = !this._previewMode;
        document.getElementById('notes-preview').style.display = this._previewMode ? 'block' : 'none';
      }
    });
  },

  setProject(name) {
    this._currentProject = name;
    this._load();
    this._renderList();
  },

  toggle() {
    const panel = document.getElementById('notes-panel');
    panel?.classList.toggle('hidden');
    if (!panel?.classList.contains('hidden')) { this._renderList(); if (this._activeNote) this._loadNote(this._activeNote); }
  },

  hide() { document.getElementById('notes-panel')?.classList.add('hidden'); },

  async create() {
    const name = prompt('Note name:') || 'note-' + Date.now();
    if (this._useDb) {
      try {
        await window.electronAPI.flordeDb.run(this._currentProject,
          'INSERT OR REPLACE INTO notes (name, content, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
          [name, '# ' + name + '\n\n']);
      } catch {}
    }
    this._notes[name] = { content: '# ' + name + '\n\n', updatedAt: Date.now() };
    this._activeNote = name;
    this._save();
    this._renderList();
    this._loadNote(name);
  },

  async save() {
    if (!this._activeNote || !this._dirty) return;
    const editor = document.getElementById('notes-editor');
    if (this._notes[this._activeNote]) {
      this._notes[this._activeNote].content = editor?.value || '';
      this._notes[this._activeNote].updatedAt = Date.now();
    }
    if (this._useDb) {
      try {
        await window.electronAPI.flordeDb.run(this._currentProject,
          'UPDATE notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?',
          [editor?.value || '', this._activeNote]);
      } catch {}
    }
    this._dirty = false;
    this._save();
  },

  async remove(name) {
    delete this._notes[name];
    if (this._activeNote === name) this._activeNote = Object.keys(this._notes)[0] || null;
    if (this._useDb) {
      try {
        await window.electronAPI.flordeDb.run(this._currentProject,
          'DELETE FROM notes WHERE name = ?', [name]);
      } catch {}
    }
    this._save();
    this._renderList();
    if (this._activeNote) this._loadNote(this._activeNote);
    else { document.getElementById('notes-editor').value = ''; document.getElementById('notes-preview').innerHTML = ''; }
  },

  async _load() {
    this._useDb = false;
    if (!this._currentProject) return;
    try {
      const hasDb = await window.electronAPI.flordeDir.check(this._currentProject);
      if (hasDb) {
        const rows = await window.electronAPI.flordeDb.query(this._currentProject,
          'SELECT name, content, updated_at FROM notes ORDER BY name');
        this._notes = {};
        for (const row of rows) {
          this._notes[row.name] = { content: row.content, updatedAt: new Date(row.updated_at).getTime() };
        }
        const names = Object.keys(this._notes);
        this._activeNote = names[0] || null;
        this._useDb = true;
        return;
      }
    } catch {}
    try {
      const key = 'florde-notes-' + this._currentProject;
      this._notes = JSON.parse(localStorage.getItem(key)) || {};
      const names = Object.keys(this._notes);
      this._activeNote = names[0] || null;
    } catch { this._notes = {}; this._activeNote = null; }
  },

  _save() {
    if (!this._currentProject || this._useDb) return;
    localStorage.setItem('florde-notes-' + this._currentProject, JSON.stringify(this._notes));
  },

  _renderList() {
    const container = document.getElementById('notes-list');
    if (!container) return;
    container.innerHTML = Object.keys(this._notes).map(name => `
      <div class="note-item ${name === this._activeNote ? 'active' : ''}">
        <span class="note-name">${escapeHtml(name)}</span>
        <button class="note-remove" data-name="${escapeHtml(name)}" style="background:none;border:none;cursor:pointer;padding:0 2px;">&times;</button>
      </div>
    `).join('');
    container.querySelectorAll('.note-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('note-remove')) return;
        this.save();
        this._activeNote = item.querySelector('.note-name').textContent;
        this._renderList();
        this._loadNote(this._activeNote);
      });
    });
    container.querySelectorAll('.note-remove').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.remove(btn.dataset.name); });
    });
  },

  _loadNote(name) {
    const note = this._notes[name];
    if (!note) return;
    document.getElementById('notes-editor').value = note.content;
    this._dirty = false;
    this.updatePreview();
  },

  updatePreview() {
    const preview = document.getElementById('notes-preview');
    if (!preview || !this._previewMode) return;
    const text = document.getElementById('notes-editor')?.value || '';
    let html = escapeHtml(text)
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/_(.+?)_/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
    preview.innerHTML = '<p>' + html + '</p>';
  }
};

// ==================== DEBOUNCE ====================

function debounce(fn, ms) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

// ==================== MANAGEMENT PANEL ====================

const ManagementPanel = {
  _activeTab: 'todo',

  init() {
    document.getElementById('btn-management-toggle')?.addEventListener('click', () => this.toggle());
    document.getElementById('btn-ci-toggle')?.addEventListener('click', () => { this.show('ci'); });
    document.getElementById('btn-management-close')?.addEventListener('click', () => this.hide());
    document.querySelectorAll('.mgmt-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        if (tab) this.switchTab(tab);
      });
    });
    document.getElementById('btn-florde-init')?.addEventListener('click', async () => {
      if (!currentProject) return;
      await window.electronAPI.flordeDb.ensureDir(currentProject);
      await window.electronAPI.flordeDb.initDb(currentProject);
      window._memoryFileList = await window.electronAPI.flordeFs.memoryList(currentProject);
      this._refreshFlordeTab();
      showNotification('success', '.florde initialized for ' + currentProject);
    });
    document.getElementById('btn-florde-migrate')?.addEventListener('click', async () => {
      if (!currentProject) return;
      await migrateLocalStorageToFlorde(currentProject);
    });
    document.getElementById('btn-florde-remove')?.addEventListener('click', async () => {
      if (!currentProject) return;
      if (!confirm('Remove .florde folder for ' + currentProject + '? Data will stay in localStorage.')) return;
      await window.electronAPI.flordeDir.remove(currentProject);
      window._memoryFileList = [];
      this._refreshFlordeTab();
      showNotification('info', '.florde removed for ' + currentProject);
    });
  },

  toggle() {
    const panel = document.getElementById('management-panel');
    panel?.classList.toggle('hidden');
    if (!panel?.classList.contains('hidden')) {
      this._refreshActiveTab();
    }
  },

  show(tab) {
    const panel = document.getElementById('management-panel');
    if (!panel) return;
    panel.classList.remove('hidden');
    if (tab) this.switchTab(tab);
    else this._refreshActiveTab();
  },

  hide() {
    document.getElementById('management-panel')?.classList.add('hidden');
  },

  switchTab(tabName) {
    document.querySelectorAll('.mgmt-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.mgmt-content').forEach(el => {
      el.classList.toggle('hidden', el.id !== 'mgmt-' + tabName);
    });
    this._activeTab = tabName;
    this._refreshActiveTab();
  },

  async _refreshActiveTab() {
    switch (this._activeTab) {
      case 'todo': TodoList.render(); break;
      case 'notes': Notes._renderList(); if (Notes._activeNote) Notes._loadNote(Notes._activeNote); break;
      case 'decisions': DecisionLog.render(); break;
      case 'ci':
        if (typeof CodeIntelligence !== 'undefined') {
          CodeIntelligence._resultsEl = document.getElementById('ci-results');
          CodeIntelligence._renderTools();
        }
        break;
      case 'florde':
        await this._refreshFlordeTab();
        break;
    }
  },

  async _refreshFlordeTab() {
    const project = currentProject;
    if (!project) return;
    const statusEl = document.getElementById('florde-status');
    const memListEl = document.getElementById('florde-memory-list');
    const tempListEl = document.getElementById('florde-temp-list');
    const giEl = document.getElementById('florde-gitignore');
    if (!statusEl) return;
    try {
      const has = await window.electronAPI.flordeDir.check(project);
      const dbPath = await window.electronAPI.flordeDb.getDbPath(project);
      const dirPath = await window.electronAPI.flordeDir.getPath(project);
      let html = has ? '✅ .florde exists' : '❌ No .florde folder';
      if (dirPath) html += `<br><span style="font-size:0.65rem;color:var(--text3);">📁 ${escapeHtml(dirPath)}</span>`;
      if (dbPath) html += `<br><span style="font-size:0.65rem;color:var(--text3);">🗄️ ${escapeHtml(dbPath)}</span>`;
      statusEl.innerHTML = html;
      if (has) {
        const memFiles = await window.electronAPI.flordeFs.memoryList(project);
        memListEl.innerHTML = memFiles.length
          ? memFiles.map(f => `<div style="padding:0.1rem 0;">📄 ${f}</div>`).join('')
          : '<em>No memory files</em>';
        const tempFiles = await window.electronAPI.flordeFs.tempList(project);
        tempListEl.innerHTML = tempFiles.length
          ? tempFiles.map(f => `<div style="padding:0.1rem 0;display:flex;justify-content:space-between;">
              <span>📄 ${f.name} (${f.size}b)</span>
              <button class="btn-temp-delete" data-file="${f.name}" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:0.7rem;">✕</button>
            </div>`).join('')
          : '<em>No temp files</em>';
        tempListEl.querySelectorAll('.btn-temp-delete').forEach(btn => {
          btn.addEventListener('click', async () => {
            await window.electronAPI.flordeFs.tempDelete(project, btn.dataset.file);
            this._refreshFlordeTab();
          });
        });
        const giState = await window.electronAPI.flordeDir.getGitignoreState(project);
        const entries = [
          { id: 'memory', label: 'memory/', path: 'memory/' },
          { id: 'rules', label: '  rules.md', path: 'memory/rules.md' },
          { id: 'memory-md', label: '  memory.md', path: 'memory/memory.md' },
          { id: 'goals', label: '  goals.md', path: 'memory/goals.md' },
          { id: 'style', label: '  style.md', path: 'memory/style.md' },
          { id: 'arch', label: '  architecture.md', path: 'memory/architecture.md' },
          { id: 'decisions-md', label: '  decisions.md', path: 'memory/decisions.md' },
          { id: 'temp', label: 'temp/', path: 'temp/' },
        ];
        giEl.innerHTML = '<div style="margin-bottom:0.3rem;font-size:0.7rem;color:var(--text3);">Track these in git:</div>' +
          entries.map(e => `<label style="display:flex;align-items:center;gap:0.3rem;font-size:0.7rem;cursor:pointer;padding:0.05rem 0;">
            <input type="checkbox" class="gi-checkbox" data-path="${e.path}" ${giState.includes(e.path) ? 'checked' : ''}>
            ${e.label}
          </label>`).join('');
        giEl.querySelectorAll('.gi-checkbox').forEach(cb => {
          cb.addEventListener('change', async () => {
            await window.electronAPI.flordeDir.setGitignoreEntry(project, cb.dataset.path, cb.checked);
          });
        });
      } else {
        memListEl.innerHTML = '<em>Init .florde to see memory files</em>';
        tempListEl.innerHTML = '';
        giEl.innerHTML = '';
      }
    } catch (e) {
      statusEl.textContent = '⚠ Error: ' + e.message;
    }
  }
};

// ==================== DECISION LOG ====================

const DecisionLog = {
  _decisions: [],
  _currentProject: null,
  _useDb: false,

  init() {
    document.getElementById('btn-decision-new')?.addEventListener('click', () => this.showModal());
  },

  setProject(name) {
    this._currentProject = name;
    this._load();
    this.render();
  },

  async add(data) {
    if (this._useDb) {
      try {
        const r = await window.electronAPI.flordeDb.run(this._currentProject,
          'INSERT INTO decisions (title, decision, rationale, alternatives) VALUES (?, ?, ?, ?)',
          [data.title, data.decision || data.reasons || '', data.reasons || '', JSON.stringify(data.alternatives || [])]
        );
        if (r && r.lastInsertRowid) {
          this._decisions.unshift({
            id: r.lastInsertRowid,
            title: data.title,
            date: data.date || new Date().toISOString().split('T')[0],
            reasons: data.reasons || '',
            alternatives: data.alternatives || [],
            createdAt: Date.now()
          });
        }
      } catch (e) { console.error('DecisionLog add failed', e); }
    } else {
      const entry = {
        id: Date.now(),
        title: data.title,
        date: data.date || new Date().toISOString().split('T')[0],
        reasons: data.reasons || '',
        alternatives: data.alternatives || [],
        createdAt: Date.now()
      };
      this._decisions.unshift(entry);
    }
    this._save();
    this.render();
  },

  async edit(id, data) {
    const idx = this._decisions.findIndex(d => d.id === id);
    if (idx === -1) return;
    Object.assign(this._decisions[idx], data);
    if (this._useDb) {
      try {
        await window.electronAPI.flordeDb.run(this._currentProject,
          'UPDATE decisions SET title = ?, decision = ?, rationale = ?, alternatives = ? WHERE id = ?',
          [data.title, data.decision || data.reasons || '', data.reasons || '', JSON.stringify(data.alternatives || []), id]
        );
      } catch {}
    }
    this._save();
    this.render();
  },

  async delete(id) {
    this._decisions = this._decisions.filter(d => d.id !== id);
    if (this._useDb) {
      try {
        await window.electronAPI.flordeDb.run(this._currentProject,
          'DELETE FROM decisions WHERE id = ?', [id]);
      } catch {}
    }
    this._save();
    this.render();
  },

  async _load() {
    this._useDb = false;
    if (!this._currentProject) return;
    try {
      const hasDb = await window.electronAPI.flordeDir.check(this._currentProject);
      if (hasDb) {
        const rows = await window.electronAPI.flordeDb.query(this._currentProject,
          'SELECT * FROM decisions ORDER BY created_at DESC');
        this._decisions = (rows || []).map(r => ({
          id: r.id,
          title: r.title,
          date: r.created_at ? r.created_at.split('T')[0] : new Date().toISOString().split('T')[0],
          reasons: r.rationale || r.decision || '',
          alternatives: (() => { try { return JSON.parse(r.alternatives || '[]'); } catch { return []; } })(),
          createdAt: new Date(r.created_at || Date.now()).getTime()
        }));
        this._useDb = true;
        return;
      }
    } catch {}
    try {
      const key = 'florde-decisions-' + this._currentProject;
      this._decisions = JSON.parse(localStorage.getItem(key)) || [];
    } catch { this._decisions = []; }
  },

  _save() {
    if (!this._currentProject || this._useDb) return;
    localStorage.setItem('florde-decisions-' + this._currentProject, JSON.stringify(this._decisions));
  },

  render() {
    const container = document.getElementById('decision-list');
    if (!container) return;
    if (!this._decisions.length) {
      container.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text3);font-size:0.8rem;">No decisions yet</div>';
      return;
    }
    container.innerHTML = this._decisions.map(d => `
      <div class="decision-card" data-id="${d.id}">
        <div class="decision-header">
          <div class="decision-title">${escapeHtml(d.title)}</div>
          <div class="decision-date">${escapeHtml(d.date)}</div>
        </div>
        ${d.reasons ? `<div class="decision-reasons"><div class="decision-reasons-summary">${escapeHtml(d.reasons)}</div></div>` : ''}
        ${d.alternatives && d.alternatives.length ? `<div class="decision-alternatives"><div class="decision-alt-label">Alternatives considered:</div>${d.alternatives.map(a => `<div class="decision-alt-item${a.rejected ? ' rejected' : ''}">${escapeHtml(a.label)}</div>`).join('')}</div>` : ''}
        <div class="decision-actions">
          <button class="btn-decision-edit" data-id="${d.id}">Edit</button>
          <button class="btn-decision-delete" data-id="${d.id}" style="color:#ef4444;">Delete</button>
        </div>
      </div>
    `).join('');
    container.querySelectorAll('.btn-decision-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id);
        const entry = this._decisions.find(d => d.id === id);
        if (entry) this.showModal(entry);
      });
    });
    container.querySelectorAll('.btn-decision-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Delete this decision?')) this.delete(parseInt(btn.dataset.id));
      });
    });
  },

  showModal(entry) {
    const existing = document.getElementById('decision-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'decision-modal-overlay';
    overlay.innerHTML = `
      <div id="decision-modal">
        <h3>${entry ? 'Edit Decision' : 'New Decision'}</h3>
        <label>Decision</label>
        <input type="text" id="decision-title" value="${entry ? escapeHtml(entry.title) : ''}" placeholder="What was decided?" />
        <label>Date</label>
        <input type="date" id="decision-date" value="${entry ? entry.date : new Date().toISOString().split('T')[0]}" />
        <label>Reasons</label>
        <textarea id="decision-reasons" placeholder="Why was this decision made?">${entry ? escapeHtml(entry.reasons) : ''}</textarea>
        <label>Alternatives (one per line, prefix rejected with X)</label>
        <textarea id="decision-alternatives" placeholder="Alternative A&#10;X Alternative B (rejected)">${entry ? (entry.alternatives || []).map(a => (a.rejected ? 'X ' : '') + a.label).join('\n') : ''}</textarea>
        <div id="decision-modal-actions">
          <button id="btn-decision-cancel">Cancel</button>
          <button id="btn-decision-save" class="btn-primary">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('btn-decision-cancel').addEventListener('click', () => overlay.remove());
    document.getElementById('btn-decision-save').addEventListener('click', () => {
      const title = document.getElementById('decision-title')?.value.trim();
      if (!title) return;
      const date = document.getElementById('decision-date')?.value || new Date().toISOString().split('T')[0];
      const reasons = document.getElementById('decision-reasons')?.value.trim() || '';
      const altText = document.getElementById('decision-alternatives')?.value || '';
      const alternatives = altText.split('\n').filter(l => l.trim()).map(l => {
        const rejected = l.trim().startsWith('X ');
        return { label: rejected ? l.trim().slice(2) : l.trim(), rejected };
      });
      const data = { title, date, reasons, alternatives };
      if (entry) this.edit(entry.id, data);
      else this.add(data);
      overlay.remove();
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }
};

// ==================== KI-AKTIONEN AUDIT LOG ====================

const AuditLog = {
  _logs: [],
  _currentProject: null,
  _aiMode: false,
  _maxLogs: 500,
  _useDb: false,

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

  async log(entry) {
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
    if (this._useDb) {
      try {
        await window.electronAPI.flordeDb.run(this._currentProject,
          `INSERT INTO audit_log (project, event_type, data) VALUES (?, ?, ?)`,
          [this._currentProject, entry.type || 'unknown', JSON.stringify(logEntry)]
        );
      } catch {}
    }
    this._save();
  },

  async _load() {
    this._useDb = false;
    if (!this._currentProject) return;
    try {
      const hasDb = await window.electronAPI.flordeDir.check(this._currentProject);
      if (hasDb) {
        const rows = await window.electronAPI.flordeDb.query(this._currentProject,
          'SELECT data FROM audit_log WHERE project = ? ORDER BY id DESC LIMIT ?',
          [this._currentProject, this._maxLogs]);
        if (rows && rows.length > 0) {
          this._logs = rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
          this._useDb = true;
          return;
        }
      }
    } catch {}
    try {
      const key = 'florde-audit-ki-' + this._currentProject;
      this._logs = JSON.parse(localStorage.getItem(key)) || [];
    } catch { this._logs = []; }
  },

  _save() {
    if (!this._currentProject || this._useDb) return;
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
      const { provider: prov } = resolveProvider();
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

// ==================== RAG MANAGER ====================

const RagManager = {
  _index: [],
  _currentProject: null,
  _status: 'idle',

  init() {
    document.getElementById('btn-rag-toggle')?.addEventListener('click', () => this.toggle());
    document.getElementById('btn-rag-close')?.addEventListener('click', () => this.hide());
    document.getElementById('btn-rag-reindex')?.addEventListener('click', () => this.indexProject());
    document.getElementById('rag-search')?.addEventListener('input', debounce(() => {
      const q = document.getElementById('rag-search')?.value.trim();
      if (q) this.search(q);
      else this._renderResults([]);
    }, 300));
  },

  setProject(name) {
    this._currentProject = name;
    this._index = [];
    const autoReindex = document.getElementById('rag-auto')?.checked;
    if (autoReindex && name) setTimeout(() => this.indexProject(), 1000);
  },

  toggle() {
    document.getElementById('rag-panel')?.classList.toggle('hidden');
  },

  hide() {
    document.getElementById('rag-panel')?.classList.add('hidden');
  },

  setStatus(s) {
    this._status = s;
    const el = document.getElementById('rag-status');
    if (el) el.textContent = s;
  },

  async indexProject() {
    if (!this._currentProject) return;
    this.setStatus('Indexing...');
    
    try {
      const include = document.getElementById('rag-include')?.value || '*.{js,ts}';
      const exclude = document.getElementById('rag-exclude')?.value || 'node_modules';
      
      const files = await this._listProjectFiles(this._currentProject, include, exclude);
      const chunkSize = parseInt(document.getElementById('rag-chunk-size')?.value) || 500;
      
      this._index = [];
      for (const file of files) {
        try {
          const content = await this._readProjectFile(this._currentProject, file);
          if (!content) continue;
          const chunks = this._chunkContent(content, chunkSize);
          chunks.forEach((text, i) => {
            this._index.push({ file, chunk: i, text, tokens: this._estimateTokens(text) });
          });
        } catch (e) {
          // Skip files that can't be read
        }
      }
      
      document.getElementById('rag-file-count').textContent = files.length + ' files';
      document.getElementById('rag-chunk-count').textContent = this._index.length + ' chunks';
      const totalTokens = this._index.reduce((s, c) => s + c.tokens, 0);
      document.getElementById('rag-token-estimate').textContent = totalTokens + ' tokens';
      
      this.setStatus('Ready (' + this._index.length + ' chunks)');
    } catch (e) {
      this.setStatus('Error: ' + e.message);
    }
  },

  async _listProjectFiles(project, include, exclude) {
    if (window.electronAPI?.projectListFiles) {
      const all = await window.electronAPI.projectListFiles(project);
      const excludeDirs = exclude.split(',').map(s => s.trim());
      const includePats = include.split(',').map(s => s.trim());
      
      return all.filter(f => {
        for (const ex of excludeDirs) {
          if (f.includes(ex) || f.startsWith(ex)) return false;
        }
        for (const pat of includePats) {
          const regex = new RegExp('^' + globToRegex(pat) + '$');
          const basename = f.split('/').pop() || f.split('\\').pop();
          if (regex.test(basename) || regex.test(f)) return true;
        }
        return false;
      });
    }
    return [];
  },

  async _readProjectFile(project, file) {
    if (window.electronAPI?.projectReadFile) {
      const r = await window.electronAPI.projectReadFile(project, file);
      return r || null;
    }
    return null;
  },

  _chunkContent(content, size) {
    const chunks = [];
    for (let i = 0; i < content.length; i += size) {
      chunks.push(content.substring(i, i + size));
    }
    return chunks.length ? chunks : [''];
  },

  _estimateTokens(text) {
    return Math.ceil(text.length / 4);
  },

  search(query) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const maxChunks = parseInt(document.getElementById('rag-max-chunks')?.value) || 5;
    
    const scored = this._index.map(chunk => {
      const lower = chunk.text.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (lower.includes(term)) score += (term.length / lower.length) * 100;
      }
      // TF-like scoring
      for (const term of terms) {
        const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const matches = chunk.text.match(regex);
        if (matches) score += matches.length * 2;
      }
      return { ...chunk, score };
    });
    
    scored.sort((a, b) => b.score - a.score);
    this._renderResults(scored.slice(0, maxChunks));
  },

  _renderResults(results) {
    const container = document.getElementById('rag-results');
    if (!container) return;
    if (!results.length) {
      container.innerHTML = '<div style="padding:0.75rem;color:var(--text3);text-align:center;">No results</div>';
      return;
    }
    container.innerHTML = results.map(r => `
      <div class="rag-result">
        <div class="rag-result-score">${r.score.toFixed(1)}</div>
        <div class="rag-result-file">${escapeHtml(r.file)}:${r.chunk}</div>
        <div class="rag-result-snippet">${this._escapeHtml(r.text.substring(0, 200))}</div>
      </div>
    `).join('');
  },

  _escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },

  // Get relevant context for AI prompts
  getContext(query, maxChunks) {
    maxChunks = maxChunks || parseInt(document.getElementById('rag-max-chunks')?.value) || 5;
    const scored = this._index.map(chunk => {
      const lower = chunk.text.toLowerCase();
      const terms = query.toLowerCase().split(/\s+/);
      let score = 0;
      for (const term of terms) {
        if (lower.includes(term)) score += 1;
      }
      return { ...chunk, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, maxChunks);
    if (!top.length) return '';
    return top.map(r => `--- ${r.file} (chunk ${r.chunk}) ---\n${r.text}`).join('\n\n');
  }
};

function globToRegex(pattern) {
  return pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
}

loadSettings().catch(e => console.error('loadSettings failed:', e));
WorkspaceManager.init();
Favorites.init();
PermissionManager.init();
ChatManager.init();
TodoList.init();
Notes.init();
RagManager.init();
DecisionLog.init();
AuditLog.init();
ManagementPanel.init();
if (typeof ApiKeyManager !== 'undefined') ApiKeyManager.init();
// CodeIntelligence.init() removed — lifecycle managed by ManagementPanel
TabGroupManager.init();
pluginRegistry.init().then(() => {
  window.__updateTools();
});

// Layout Snap Toggle
let layoutSnapped = false;
document.getElementById('btn-layout-snap')?.addEventListener('click', () => {
  layoutSnapped = !layoutSnapped;
  document.body.classList.toggle('layout-snapped', layoutSnapped);
  document.getElementById('btn-layout-snap')?.style ? document.getElementById('btn-layout-snap').style.opacity = layoutSnapped ? '1' : '0.5' : null;
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
          s5.onload = () => {
            const s6 = document.createElement('script');
            s6.src = 'git/git-graph.js';
            document.head.appendChild(s6);
            s6.onload = async () => {
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
  _terminals: {}, _activeTerminalId: null, _unsubscribers: [], _splitCount: 0, _splits: [], _maxSplits: 4,

  async create(projectPath, splitId) {
    if (!window.electronAPI || !window.electronAPI.terminal) {
      if (typeof showNotification !== 'undefined') showNotification('error', 'Terminal not available', '\u2715');
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
    if (splitId) {
      const splitEl = document.querySelector(`.terminal-split[data-split-id="${splitId}"] .terminal-split-instance`);
      if (splitEl) splitEl.appendChild(container);
    } else {
      document.getElementById('terminal-container').appendChild(container);
    }
    term.open(container);
    const unsubData = window.electronAPI.terminal.onData(({ id: termId, data }) => { if (termId === id) { term.write(data); term.scrollToBottom(); } });
    const unsubExit = window.electronAPI.terminal.onExit(({ id: termId }) => { if (termId === id) term.write('\r\n\x1b[31m[Process exited]\x1b[0m'); });
    term.onData(data => { window.electronAPI.terminal.write({ id, data }); });
    this._unsubscribers.push(unsubData, unsubExit);
    this._terminals[id] = { term, fitAddon, id, splitId };
    new ResizeObserver(() => { try { fitAddon.fit(); } catch (e) {} }).observe(container);
    setTimeout(() => { try { fitAddon.fit(); } catch (e) {} }, 100);
    this._activeTerminalId = id;
    return id;
  },

  async createSplit(direction) {
    if (this._splitCount >= this._maxSplits) {
      showNotification('warning', 'Maximum 4 splits reached', '\u26A0');
      return;
    }
    const splitsContainer = document.getElementById('terminal-splits');
    if (!splitsContainer) return;
    if (this._splitCount === 0) {
      splitsContainer.style.flexDirection = direction === 'horizontal' ? 'row' : 'column';
    } else {
      splitsContainer.style.flexDirection = direction === 'horizontal' ? 'row' : 'column';
    }
    const splitId = 'split-' + Date.now();
    const splitEl = document.createElement('div');
    splitEl.className = 'terminal-split';
    splitEl.dataset.splitId = splitId;
    splitEl.innerHTML = `<div class="terminal-split-header"><span>Terminal</span><button class="terminal-split-close" data-split-id="${splitId}">&times;</button></div><div class="terminal-split-instance"></div>`;
    splitsContainer.appendChild(splitEl);
    this._splitCount++;
    this._splits.push(splitId);
    splitEl.querySelector('.terminal-split-header').addEventListener('click', () => this.setActiveSplit(splitId));
    splitEl.querySelector('.terminal-split-close').addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeSplit(splitId);
    });
    const termId = await this.create(currentProject, splitId);
    if (termId) this.setActiveSplit(splitId);
    return splitId;
  },

  setActiveSplit(splitId) {
    document.querySelectorAll('.terminal-split').forEach(el => el.classList.remove('active'));
    const splitEl = document.querySelector(`.terminal-split[data-split-id="${splitId}"]`);
    if (splitEl) splitEl.classList.add('active');
    const entry = Object.values(this._terminals).find(t => t.splitId === splitId);
    if (entry) {
      this._activeTerminalId = entry.id;
      const label = document.getElementById('terminal-active-label');
      if (label) label.textContent = `Terminal ${this._splits.indexOf(splitId) + 1}`;
    }
  },

  closeSplit(splitId) {
    const entry = Object.values(this._terminals).find(t => t.splitId === splitId);
    if (entry) {
      window.electronAPI.terminal.kill({ id: entry.id }).catch(() => {});
      delete this._terminals[entry.id];
      const instEl = document.getElementById('term-instance-' + entry.id);
      if (instEl) instEl.remove();
    }
    const splitEl = document.querySelector(`.terminal-split[data-split-id="${splitId}"]`);
    if (splitEl) splitEl.remove();
    this._splits = this._splits.filter(s => s !== splitId);
    this._splitCount = Math.max(0, this._splitCount - 1);
    if (this._splits.length > 0) this.setActiveSplit(this._splits[this._splits.length - 1]);
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
    if (this._splitCount === 0) {
      const splitsContainer = document.getElementById('terminal-splits');
      if (splitsContainer && splitsContainer.children.length === 0) {
        const firstSplit = document.createElement('div');
        firstSplit.className = 'terminal-split active';
        firstSplit.dataset.splitId = 'split-first';
        firstSplit.innerHTML = `<div class="terminal-split-header"><span>Terminal 1</span><button class="terminal-split-close" data-split-id="split-first">&times;</button></div><div class="terminal-split-instance"></div>`;
        splitsContainer.appendChild(firstSplit);
        this._splitCount = 1;
        this._splits.push('split-first');
        const instEl = document.getElementById('term-instance-' + this._activeTerminalId);
        if (instEl) {
          const targetEl = firstSplit.querySelector('.terminal-split-instance');
          if (targetEl) targetEl.appendChild(instEl);
        }
        firstSplit.querySelector('.terminal-split-header').addEventListener('click', () => this.setActiveSplit('split-first'));
        firstSplit.querySelector('.terminal-split-close').addEventListener('click', (e) => {
          e.stopPropagation();
          this.closeSplit('split-first');
        });
        const label = document.getElementById('terminal-active-label');
        if (label) label.textContent = 'Terminal 1';
      }
    }
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
    if (!window.electronAPI?.browser) return false;
    return window.electronAPI.browser.isOpen();
  },

  async navigate(url) {
    if (!window.electronAPI?.browser) throw new Error('Browser not available');
    if (!url.match(/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//)) {
      url = 'http://' + url;
    }
    this.show();
    await window.electronAPI.browser.open(url);
  },

  async evaluate(js) {
    if (!window.electronAPI?.browser) throw new Error('Browser not available');
    const isOpen = await window.electronAPI.browser.isOpen();
    if (!isOpen) throw new Error('No page loaded in browser. Use browser_open first.');
    return await window.electronAPI.browser.evaluate(js);
  },

  async screenshot() {
    if (!window.electronAPI?.browser) return null;
    const isOpen = await window.electronAPI.browser.isOpen();
    if (!isOpen) return null;
    try {
      return await window.electronAPI.browser.capturePage();
    } catch (err) {
      console.error('Screenshot error:', err);
      return null;
    }
  },

  async back() { if (!window.electronAPI?.browser) return; try { await window.electronAPI.browser.goBack(); } catch (e) { console.error('Browser back error:', e); } },
  async forward() { if (!window.electronAPI?.browser) return; try { await window.electronAPI.browser.goForward(); } catch (e) { console.error('Browser forward error:', e); } },
  async reload() { if (!window.electronAPI?.browser) return; try { await window.electronAPI.browser.reload(); } catch (e) { console.error('Browser reload error:', e); } },
  async close() { if (!window.electronAPI?.browser) return; try { await window.electronAPI.browser.close(); } catch (e) { console.error('Browser close error:', e); } },
  abortAll() { window.electronAPI?.browser?.close?.().catch?.(() => {}); },
};

const DockerPanel = {
  _refreshTimer: null,

  async checkDocker() {
    if (!window.electronAPI?.docker) return false;
    try {
      const info = await window.electronAPI.docker.info();
      const statusEl = document.getElementById('docker-status');
      if (statusEl) {
        statusEl.style.color = info.ok ? '#22c55e' : '#ef4444';
        statusEl.title = info.ok ? `Docker v${info.version}` : 'Docker not available';
      }
      return info.ok;
    } catch (e) {
      console.error('Docker check failed:', e);
      return false;
    }
  },

  async refreshContainers() {
    if (!await this.checkDocker()) return;
    const res = await window.electronAPI.docker.ps();
    const containerEl = document.getElementById('docker-containers');
    if (!containerEl) return;
    if (!res.ok) { containerEl.innerHTML = '<div class="docker-error">' + (res.error || 'Failed to list containers') + '</div>'; return; }
    containerEl.innerHTML = (res.containers || []).map(c => `
      <div class="docker-container-row" data-id="${c.id}">
        <span class="docker-status-dot ${c.running ? 'running' : 'stopped'}"></span>
        <span class="docker-container-name">${escapeHtml(c.name)}</span>
        <span class="docker-container-image">${escapeHtml(c.image)}</span>
        <span class="docker-container-status">${escapeHtml(c.status)}</span>
        <span class="docker-container-ports">${escapeHtml(c.ports)}</span>
        <div class="docker-container-actions">
          <button class="docker-btn docker-btn-start" data-id="${c.id}" ${c.running ? 'disabled' : ''}>Start</button>
          <button class="docker-btn docker-btn-stop" data-id="${c.id}" ${!c.running ? 'disabled' : ''}>Stop</button>
          <button class="docker-btn docker-btn-restart" data-id="${c.id}">Restart</button>
          <button class="docker-btn docker-btn-logs" data-id="${c.id}">Logs</button>
        </div>
      </div>
    `).join('');

    containerEl.querySelectorAll('.docker-btn-start').forEach(btn => {
      btn.addEventListener('click', async () => {
        await window.electronAPI.docker.start(btn.dataset.id);
        this.refreshContainers();
      });
    });
    containerEl.querySelectorAll('.docker-btn-stop').forEach(btn => {
      btn.addEventListener('click', async () => {
        await window.electronAPI.docker.stop(btn.dataset.id);
        this.refreshContainers();
      });
    });
    containerEl.querySelectorAll('.docker-btn-restart').forEach(btn => {
      btn.addEventListener('click', async () => {
        await window.electronAPI.docker.restart(btn.dataset.id);
        setTimeout(() => this.refreshContainers(), 1000);
      });
    });
    containerEl.querySelectorAll('.docker-btn-logs').forEach(btn => {
      btn.addEventListener('click', async () => {
        const res = await window.electronAPI.docker.logs(btn.dataset.id, 100);
        const logEl = document.getElementById('docker-log-content');
        if (logEl) logEl.textContent = res.ok ? res.logs : (res.error || 'No logs');
        document.querySelectorAll('.docker-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.docker-panel-content').forEach(c => c.classList.add('hidden'));
        document.getElementById('docker-logs')?.classList.remove('hidden');
        document.querySelector('.docker-tab[data-docker-panel="logs"]')?.classList.add('active');
      });
    });
  },

  async refreshImages() {
    if (!await this.checkDocker()) return;
    const res = await window.electronAPI.docker.images();
    const imageEl = document.getElementById('docker-images');
    if (!imageEl) return;
    if (!res.ok) { imageEl.innerHTML = '<div class="docker-error">' + (res.error || 'Failed to list images') + '</div>'; return; }
    imageEl.innerHTML = (res.images || []).map(img => `
      <div class="docker-image-row">
        <span class="docker-image-name">${escapeHtml(img.repository)}:${escapeHtml(img.tag)}</span>
        <span class="docker-image-id">${escapeHtml(img.id)}</span>
        <span class="docker-image-size">${escapeHtml(img.size)}</span>
      </div>
    `).join('');
  },

  async refreshCompose() {
    const filesEl = document.getElementById('docker-compose-files');
    if (!filesEl) return;
    if (!currentProject) { filesEl.innerHTML = '<div class="docker-error">No project open</div>'; return; }
    try {
      const files = await window.electronAPI.projectListFiles(currentProject);
      const composeFiles = (files || []).filter(f => /docker-compose.*\.ya?ml$/i.test(f));
      if (composeFiles.length === 0) {
        filesEl.innerHTML = '<div class="docker-error">No docker-compose files found in project</div>';
        return;
      }
      filesEl.innerHTML = composeFiles.map(f => `
        <div class="docker-compose-file">
          <span class="docker-compose-file-name">${f}</span>
          <div class="docker-compose-actions">
            <button class="docker-btn docker-btn-start" data-file="${f}">Up</button>
            <button class="docker-btn docker-btn-stop" data-file="${f}">Down</button>
            <button class="docker-btn docker-btn-logs" data-file="${f}">Logs</button>
          </div>
        </div>
      `).join('');
      filesEl.querySelectorAll('.docker-btn-start').forEach(btn => {
        btn.addEventListener('click', () => this.composeUp(btn.dataset.file));
      });
      filesEl.querySelectorAll('.docker-btn-stop').forEach(btn => {
        btn.addEventListener('click', () => this.composeDown(btn.dataset.file));
      });
      filesEl.querySelectorAll('.docker-btn-logs').forEach(btn => {
        btn.addEventListener('click', () => this.composeLogs(btn.dataset.file));
      });
    } catch {
      filesEl.innerHTML = '<div class="docker-error">Failed to list compose files</div>';
    }
  },

  async composeUp(file) {
    const outputEl = document.getElementById('docker-compose-output');
    if (outputEl) outputEl.textContent = 'Running docker compose up...';
    const res = await window.electronAPI.docker.composeUp(file);
    if (outputEl) outputEl.textContent = res.ok ? (res.stdout || 'Compose up started') : ('Error: ' + (res.error || 'Unknown'));
    this.refreshContainers();
  },

  async composeDown(file) {
    const outputEl = document.getElementById('docker-compose-output');
    if (outputEl) outputEl.textContent = 'Running docker compose down...';
    const res = await window.electronAPI.docker.composeDown(file);
    if (outputEl) outputEl.textContent = res.ok ? (res.stdout || 'Compose down completed') : ('Error: ' + (res.error || 'Unknown'));
    this.refreshContainers();
  },

  async composeLogs(file) {
    const outputEl = document.getElementById('docker-compose-output');
    if (outputEl) outputEl.textContent = 'Loading compose logs...';
    const res = await window.electronAPI.docker.composeLogs(file);
    if (outputEl) outputEl.textContent = res.ok ? (res.stdout || 'No logs') : ('Error: ' + (res.error || 'Unknown'));
  },

  toggle() {
    const panel = document.getElementById('docker-panel');
    if (!panel) return;
    if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
    const wasHidden = panel.classList.contains('hidden');
    if (wasHidden) {
      document.getElementById('terminal-panel')?.classList.add('hidden');
    }
    panel.classList.toggle('hidden');
    document.getElementById('btn-docker-toggle')?.classList.toggle('active', !panel.classList.contains('hidden'));
    if (wasHidden) {
      this.refreshContainers();
      this.refreshImages();
      this.refreshCompose();
      this._refreshTimer = setInterval(() => { this.refreshContainers(); }, 5000);
    }
  },

  async init() {
    if (!window.electronAPI?.docker) return;
    await this.checkDocker();
    document.getElementById('btn-docker-toggle')?.addEventListener('click', () => this.toggle());
    document.getElementById('btn-docker-refresh')?.addEventListener('click', () => { this.refreshContainers(); this.refreshImages(); this.refreshCompose(); });
    document.getElementById('btn-docker-minimize')?.addEventListener('click', () => this.toggle());
    document.querySelectorAll('.docker-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.docker-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.docker-panel-content').forEach(c => c.classList.add('hidden'));
        tab.classList.add('active');
        const panel = document.getElementById(tab.dataset.dockerPanel);
        if (panel) panel.classList.remove('hidden');
        if (tab.dataset.dockerPanel === 'containers') this.refreshContainers();
        if (tab.dataset.dockerPanel === 'images') this.refreshImages();
        if (tab.dataset.dockerPanel === 'compose') this.refreshCompose();
      });
    });
  }
};

function initXtermTerminal() {
  TerminalManager.init().then(() => {
    document.getElementById('btn-terminal-split-h')?.addEventListener('click', () => {
      TerminalManager.createSplit('horizontal');
    });
    document.getElementById('btn-terminal-split-v')?.addEventListener('click', () => {
      TerminalManager.createSplit('vertical');
    });
    document.getElementById('terminal-output-tab')?.addEventListener('click', () => {
      document.getElementById('terminal-splits').style.display = 'none';
      document.getElementById('terminal-container').style.display = 'none';
      document.getElementById('terminal-output').classList.remove('hidden');
    });
    document.querySelectorAll('.terminal-tab:not(#terminal-output-tab)').forEach(tab => {
      tab.addEventListener('click', () => {
        document.getElementById('terminal-output').classList.add('hidden');
        document.getElementById('terminal-splits').style.display = '';
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

// ==================== MCP Manager ====================
const _mcpClients = new Map();

const TRANSPORT_LABELS = { stdio: 'STDIO', sse: 'SSE', websocket: 'WebSocket' };

function loadMcpConfig() {
  try { return JSON.parse(localStorage.getItem('florde-mcp-servers') || '[]'); } catch { return []; }
}

function saveMcpConfig(configs) {
  localStorage.setItem('florde-mcp-servers', JSON.stringify(configs));
}

async function _mcpConnect(id) {
  const cfg = loadMcpConfig().find(c => c && c.id === id);
  if (!cfg) return;
  if (!cfg.command && cfg.transport === 'stdio') {
    showNotification('error', 'MCP: Command required for STDIO Transport', '\u274C');
    return;
  }
  try {
    if (_mcpClients.has(id)) await _mcpClients.get(id).disconnect();
    const client = new McpClient(cfg);
    await client.connect();
    _mcpClients.set(id, client);
    renderMcpServers();
    showNotification('success', 'MCP Server "' + cfg.name + '" connected', '\uD83D\uDD0C');
  } catch (err) {
    showNotification('error', 'MCP Connection failed: ' + err.message, '\u274C');
    renderMcpServers();
  }
}

async function renderMcpServers() {
  const list = document.getElementById('mcp-server-list');
  if (!list) return;
  const configs = loadMcpConfig();
  const TO = TRANSPORT_LABELS;
  list.innerHTML = configs.map((cfg, i) => {
    const client = _mcpClients.get(cfg.id);
    const connected = client && client._connected;
    const status = connected ? 'connected' : 'disconnected';
    const tools = client ? client._tools : [];
    const tl = TO[cfg.transport] || cfg.transport;
    const isStdio = cfg.transport === 'stdio';
    const fields = isStdio
      ? '<label>Command</label><input class="mcp-field" data-field="command" value="' + escapeHtml(cfg.command || '') + '" placeholder="python server.py" />'
      : '<label>URL</label><input class="mcp-field" data-field="url" value="' + escapeHtml(cfg.url || '') + '" placeholder="http://localhost:6543" />';
    const transportOptions = Object.keys(TO).map(k => '<option value="' + k + '" ' + (k === cfg.transport ? 'selected' : '') + '>' + TO[k] + '</option>').join('');
    return '<div class="mcp-server-card" data-index="' + i + '" data-id="' + cfg.id + '">' +
      '<div class="mcp-server-header">' +
        '<div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">' +
          '<span class="mcp-server-name">' + escapeHtml(cfg.name || cfg.id) + '</span>' +
          '<select class="mcp-transport-select" style="font-size:0.7rem;padding:0.15rem;max-width:120px;">' +
            transportOptions +
          '</select>' +
        '</div>' +
        '<span class="mcp-server-status ' + (connected ? 'connected' : 'disconnected') + '">' + status + '</span>' +
      '</div>' +
      (tools.length > 0 ? '<div class="mcp-server-tools">Tools: ' + tools.map(t => t._originalName).join(', ') + '</div>' : '') +
      '<div class="mcp-server-config">' + fields +
        '<details style="margin-top:0.4rem;"><summary style="font-size:0.7rem;color:var(--text3);cursor:pointer;">Raw JSON</summary>' +
        '<textarea class="mcp-config-editor" data-id="' + cfg.id + '" style="width:100%;min-height:60px;background:var(--bg2);border:1px solid var(--border2);color:var(--text);padding:0.3rem;border-radius:4px;font-size:0.7rem;font-family:monospace;margin-top:0.25rem;">' + escapeHtml(JSON.stringify(cfg, null, 2)) + '</textarea>' +
        '</details>' +
      '</div>' +
      '<div class="mcp-server-actions">' +
        '<button class="btn btn-sm btn-primary mcp-connect" data-id="' + cfg.id + '">' + (connected ? 'Reconnect' : 'Connect') + '</button>' +
        '<button class="btn btn-sm btn-secondary mcp-disconnect" data-id="' + cfg.id + '" ' + (connected ? '' : 'style="display:none;"') + '>Disconnect</button>' +
        '<button class="btn btn-sm btn-secondary mcp-remove" data-id="' + cfg.id + '">Remove</button>' +
      '</div>' +
    '</div>';
  }).join('');
  list.querySelectorAll('.mcp-server-card').forEach(card => _hookMcpCard(card));
}

function _hookMcpCard(card) {
  const idx = parseInt(card.dataset.index);
  const configs = loadMcpConfig();
  const cfg = configs[idx];
  if (!cfg) return;
  card.querySelector('.mcp-connect').addEventListener('click', () => _mcpConnect(cfg.id));
  card.querySelector('.mcp-disconnect').addEventListener('click', async () => {
    if (_mcpClients.has(cfg.id)) await _mcpClients.get(cfg.id).disconnect();
    _mcpClients.delete(cfg.id);
    renderMcpServers();
  });
  card.querySelector('.mcp-remove').addEventListener('click', () => {
    const ccs = loadMcpConfig();
    const idx = parseInt(card.dataset.index);
    const removed = ccs.splice(idx, 1);
    saveMcpConfig(ccs);
    const rid = removed.length && removed[0].id;
    if (rid && _mcpClients.has(rid)) _mcpClients.get(rid).disconnect();
    if (rid) _mcpClients.delete(rid);
    renderMcpServers();
  });
  card.querySelector('.mcp-transport-select')?.addEventListener('change', function() {
    const trans = this.value;
    cfg.transport = trans;
    if (trans === 'stdio') { cfg.url = undefined; cfg.command = cfg.command || ''; cfg.args = cfg.args || []; cfg.env = cfg.env || {}; }
    else { cfg.command = undefined; cfg.args = undefined; cfg.env = undefined; }
    const ccs = loadMcpConfig().map(c => c.id === cfg.id ? cfg : c);
    saveMcpConfig(ccs);
    renderMcpServers();
  });
  card.querySelector('.mcp-field')?.addEventListener('change', function() {
    const field = this.dataset.field;
    cfg[field] = this.value;
    if (field === 'args') cfg.args = this.value ? this.value.split(' ') : [];
    const ccs = loadMcpConfig().map(c => c.id === cfg.id ? cfg : c);
    saveMcpConfig(ccs);
  });
  card.querySelector('.mcp-config-editor')?.addEventListener('change', function() {
    const id = this.dataset.id;
    try {
      const newCfg = JSON.parse(this.value);
      const ccs = loadMcpConfig().map(c => c.id === id ? { ...newCfg, id } : c);
      saveMcpConfig(ccs);
      if (_mcpClients.has(id)) { _mcpClients.get(id).disconnect(); _mcpClients.delete(id); }
      renderMcpServers();
    } catch {}
  });
}

document.getElementById('btn-add-mcp-server')?.addEventListener('click', () => {
  const configs = loadMcpConfig();
  const id = 'mcp-' + Date.now();
  configs.push({
    id, name: 'New MCP Server',
    transport: 'stdio',
    command: '',
    args: [],
    env: {}
  });
  saveMcpConfig(configs);
  renderMcpServers();
});

document.getElementById('btn-start-mcp-server')?.addEventListener('click', async () => {
  const name = document.getElementById('mcp-run-name').value.trim();
  const command = document.getElementById('mcp-run-command').value.trim();
  const port = document.getElementById('mcp-run-port').value.trim();
  if (!name || !command) {
    showNotification('error', 'Please enter name and command', '\u274C');
    return;
  }
  const args = [];
  if (port) args.push('--port', port);
  const id = 'mcp-run-' + Date.now();
  const result = await window.electronAPI.mcpExec.spawn(id, command, args, {});
  if (!result.ok) {
    showNotification('error', 'MCP Server start failed: ' + result.error, '\u274C');
    return;
  }
  showNotification('success', 'MCP Server "' + name + '\" started', '\u2705');
  const defaultPort = port || '6543';
  const configs = loadMcpConfig();
  configs.push({
    id: 'mcp-auto-' + Date.now(),
    name: name,
    transport: 'sse',
    url: 'http://localhost:' + defaultPort
  });
  saveMcpConfig(configs);
  renderMcpServers();
});

window.addEventListener('beforeunload', () => {
  for (const client of _mcpClients.values()) client.disconnect();
  if (_ollamaStatusTimer) clearInterval(_ollamaStatusTimer);
});

initEditorTools();
initGitPanel();
initXtermTerminal();
DockerPanel.init();
TimeTracking.init();
initConnectedApps();
if (typeof KeybindManager !== 'undefined') KeybindManager.init();
if (typeof SkillsManager !== 'undefined') SkillsManager.init();
if (typeof OllamaManager !== 'undefined') OllamaManager.init();

SmartSearch.setSources({
  file: async (q) => {
    const list = await window.electronAPI.projectListFiles(currentProject);
    return list.filter(f => f.toLowerCase().includes(q.toLowerCase())).map(f => ({ name: f.split('/').pop(), path: f }));
  },
  symbol: async (q) => {
    const list = await window.electronAPI.projectListFiles(currentProject);
    const out = [];
    for (const f of list.slice(0, 60)) {
      if (!/\.(js|jsx|ts|tsx|py|html|css)$/.test(f)) continue;
      let content = '';
      try { content = await window.electronAPI.projectReadFile(currentProject, f) || ''; } catch (e) { continue; }
      const lang = f.endsWith('.py') ? 'python' : f.endsWith('.html') ? 'html' : f.endsWith('.css') ? 'css' : 'javascript';
      const syms = extractSymbols(content, lang);
      syms.forEach(s => {
        if (s.name.toLowerCase().includes(q.toLowerCase())) out.push({ ...s, file: f, category: 'symbol' });
      });
    }
    return out.slice(0, 30);
  },
  memory: async (q) => {
    const names = await window.electronAPI.flordeFs.memoryList(currentProject) || [];
    const out = [];
    for (const n of names) {
      const content = await window.electronAPI.flordeFs.memoryRead(currentProject, n) || '';
      const path = '.florde/memory/' + n;
      if (content.toLowerCase().includes(q.toLowerCase()) || n.toLowerCase().includes(q.toLowerCase())) {
        out.push({ name: n, content, path });
      }
    }
    return out;
  },
  commit: async (q) => {
    const commits = await window.electronAPI.gitLog(currentProject, 50) || [];
    return commits.filter(c => c.message.toLowerCase().includes(q.toLowerCase())).map(c => ({ message: c.message, shortHash: c.shortHash, date: c.date, author: c.author }));
  },
  todo: async (q) => {
    if (typeof TodoList === 'undefined') return [];
    return TodoList._todos.filter(t => t.text.toLowerCase().includes(q.toLowerCase())).map(t => ({ text: t.text, done: !!t.done }));
  },
  decision: async (q) => {
    if (typeof DecisionLog === 'undefined') return [];
    return DecisionLog._decisions.filter(d => (d.title + ' ' + d.reasons).toLowerCase().includes(q.toLowerCase())).map(d => ({ title: d.title, decision: d.reasons }));
  },
  issue: async (q) => {
    if (!(window._connectedAppIds || []).includes('github')) return [];
    try {
      const text = await executeAppTool('github_search_issues', { q, per_page: 8 });
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end > start) parsed = JSON.parse(text.slice(start, end + 1));
      }
      const items = (parsed && parsed.items) || [];
      return items.map(it => ({ title: it.title, url: it.html_url || '', description: it.body || '' }));
    } catch (e) { return []; }
  }
});

SmartSearch.onNavigate = (nav) => {
  switch (nav.action) {
    case 'openTab':
      openTab(nav.value);
      break;
    case 'openTabAtLine':
      openTab(nav.value.path);
      setTimeout(() => {
        if (editor && editor.getModel()) {
          editor.revealLineInCenter(nav.value.line);
          editor.setPosition({ lineNumber: nav.value.line, column: 1 });
          editor.focus();
        }
      }, 200);
      break;
    case 'openGit':
      try {
        const api = (typeof LayoutManager !== 'undefined' && LayoutManager._api) || null;
        if (api) {
          const gitP = api.getPanel('git');
          if (gitP) { gitP.api.setVisible(true); gitP.api.setActive(); }
        }
        if (typeof GitPanel !== 'undefined') GitPanel.refresh();
      } catch (e) { console.warn('openGit dockview error:', e); }
      break;
    case 'openPanel':
      if (typeof ManagementPanel !== 'undefined') ManagementPanel.show(nav.value);
      break;
    case 'openUrl':
      window.open(nav.value, '_blank');
      break;
  }
};

// Hook Ollama Hub download button
document.getElementById('btn-ollama-hub-download')?.addEventListener('click', () => {
  if (typeof showOllamaDownloadModal === 'function') showOllamaDownloadModal();
});

// === Browser Panel Toggle ===
document.getElementById('btn-browser-toggle')?.addEventListener('click', async () => {
  if (!window.electronAPI?.browser) return;
  const isOpen = await window.electronAPI.browser.isOpen();
  if (isOpen) {
    await BrowserPanel.close();
    BrowserPanel.hide();
  } else {
    BrowserPanel.show();
    await BrowserPanel.navigate('https://duckduckgo.com');
  }
});

// ==================== AI ROUTER ====================

const AIRouter = {
  _routes: [],
  _activeRouteId: null,

  init() {
    try {
      const s = JSON.parse(localStorage.getItem('florde-settings') || '{}');
      this._routes = s.aiRoutes || [];
      this._activeRouteId = s.activeRouteId || null;
    } catch { this._routes = []; this._activeRouteId = null; }
    this._setupEvents();
    this.renderDropdown();
  },

  _setupEvents() {
    document.getElementById('btn-ai-router')?.addEventListener('click', () => this.showModal());
    document.getElementById('btn-ai-router-close')?.addEventListener('click', () => this.hideModal());
    document.getElementById('btn-ai-router-add')?.addEventListener('click', () => this.addRoute());
    document.getElementById('provider-select')?.addEventListener('change', () => {
      const val = document.getElementById('provider-select').value;
      if (val.startsWith('route:')) {
        this._activeRouteId = val.slice(6);
        this._save();
      }
    });
  },

  _save() {
    try {
      const s = JSON.parse(localStorage.getItem('florde-settings') || '{}');
      s.aiRoutes = this._routes;
      s.activeRouteId = this._activeRouteId;
      localStorage.setItem('florde-settings', JSON.stringify(s));
      saveSettingsToDisk(s);
    } catch {}
  },

  showModal() {
    this.renderRoutes();
    document.getElementById('ai-router-modal')?.classList.remove('hidden');
  },

  hideModal() {
    document.getElementById('ai-router-modal')?.classList.add('hidden');
  },

  addRoute() {
    const id = 'route-' + Date.now();
    this._routes.push({
      id,
      name: 'New Route',
      provider: 'openai',
      model: '',
      key: '',
      url: '',
      temperature: 0.7,
      enabled: true,
    });
    this._activeRouteId = id;
    this._save();
    this.renderRoutes();
    this.renderDropdown();
  },

  removeRoute(id) {
    this._routes = this._routes.filter(r => r.id !== id);
    if (this._activeRouteId === id) this._activeRouteId = this._routes[0]?.id || null;
    this._save();
    this.renderRoutes();
    this.renderDropdown();
  },

  updateRoute(id, field, value) {
    const route = this._routes.find(r => r.id === id);
    if (!route) return;
    route[field] = value;
    this._save();
    this.renderDropdown();
  },

  setActive(id) {
    this._activeRouteId = id;
    this._save();
    this.renderDropdown();
  },

  getActiveRoute() {
    return this._routes.find(r => r.id === this._activeRouteId) || null;
  },

  getProviderForRoute(route) {
    if (!route) return null;
    const providerTypes = {
      openai: [OpenAIProvider, 'key', 'model', 'gpt-5.5'],
      deepseek: [DeepSeekProvider, 'key', 'model', 'deepseek-chat'],
      mistral: [MistralProvider, 'key', 'model', 'mistral-large-latest'],
      anthropic: [AnthropicProvider, 'key', 'model', 'claude-sonnet-4-6'],
      gemini: [GeminiProvider, 'key', 'model', 'gemini-2.5-flash'],
      grok: [GrokProvider, 'key', 'model', 'grok-4.3'],
      opencodezen: [OpenCodeProvider, 'key', 'model', 'big-pickle'],
      opencodego: [OpenCodeGoProvider, 'key', 'model', 'deepseek-v4-flash'],
      openrouter: [OpenRouterProvider, 'key', 'model', 'openai/gpt-4o'],
      custom: [CustomProvider, 'key', 'model', 'custom-model'],
      ollama: [OllamaProvider, 'url', 'model', 'qwen2.5-coder'],
      lmstudio: [LMStudioProvider, 'url', 'model', 'local-model'],
      localai: [LocalAIProvider, 'url', 'model', 'local-model'],
    };
    const cfg = providerTypes[route.provider];
    if (!cfg) return null;
    const [Ctor, keyField, modelField, defaultModel] = cfg;
    const val = keyField === 'url' ? (route.url || '') : (route.key || '');
    if (!val && keyField !== 'url') return null;
    const model = route.model || defaultModel;
    let inst;
    if (route.provider === 'custom') {
      inst = new Ctor(val, model, route.url || '');
    } else if (route.provider === 'ollama' || route.provider === 'lmstudio' || route.provider === 'localai') {
      inst = new Ctor(val || '', model);
    } else {
      inst = new Ctor(val, model);
    }
    if (inst) inst.temperature = route.temperature || 0.7;
    return inst;
  },

  renderDropdown() {
    const sel = document.getElementById('provider-select');
    if (!sel) return;
    const current = sel.value;
    let html = '';
    if (this._routes.length > 0) {
      for (const route of this._routes) {
        if (!route.enabled) continue;
        const prov = this._getProviderLabel(route.provider);
        const model = route.model || this._getDefaultModel(route.provider);
        const active = route.id === this._activeRouteId ? ' selected' : '';
        html += `<option value="route:${route.id}"${active}>${this._esc(route.name)} (${prov}: ${model})</option>`;
      }
      html += '<option disabled>────────────</option>';
    }
    const providerTypes = [
      ['openai', 'OpenAI'], ['deepseek', 'DeepSeek'], ['mistral', 'Mistral'],
      ['anthropic', 'Anthropic'], ['gemini', 'Gemini'], ['grok', 'Grok'],
      ['opencodezen', 'OpenCode Zen'], ['opencodego', 'OpenCode Go'], ['ollama', 'Ollama'], ['lmstudio', 'LM Studio'],
      ['localai', 'LocalAI'], ['openrouter', 'OpenRouter'], ['custom', 'Custom']
    ];
    for (const [id, label] of providerTypes) {
      if (providers[id]) {
        const model = providers[id].model || '';
        html += `<option value="${id}">${label} (${this._esc(model)})</option>`;
      }
    }
    sel.innerHTML = html;
    if (current && sel.querySelector(`option[value="${current}"]`)) {
      sel.value = current;
    } else if (this._activeRouteId && sel.querySelector(`option[value="route:${this._activeRouteId}"]`)) {
      sel.value = 'route:' + this._activeRouteId;
    }
  },

  _getProviderLabel(id) {
    const labels = { openai:'OpenAI', deepseek:'DeepSeek', mistral:'Mistral', anthropic:'Anthropic', gemini:'Gemini', grok:'Grok', opencodezen:'OpenCode Zen', opencodego:'OpenCode Go', openrouter:'OpenRouter', custom:'Custom', ollama:'Ollama', lmstudio:'LM Studio', localai:'LocalAI' };
    return labels[id] || id;
  },

  _getDefaultModel(id) {
    const defaults = { openai:'gpt-5.5', deepseek:'deepseek-chat', mistral:'mistral-large-latest', anthropic:'claude-sonnet-4-6', gemini:'gemini-2.5-flash', grok:'grok-4.3', opencodezen:'big-pickle', opencodego:'deepseek-v4-flash', openrouter:'openai/gpt-4o', custom:'custom-model', ollama:'qwen2.5-coder', lmstudio:'local-model', localai:'local-model' };
    return defaults[id] || 'unknown';
  },

  _esc(s) { return (s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); },

  renderRoutes() {
    const container = document.getElementById('ai-router-routes');
    if (!container) return;
    if (this._routes.length === 0) {
      container.innerHTML = '<div style="text-align:center;color:var(--text3);padding:2rem;">No routes configured. Click "+ Add Route" to create one.</div>';
      return;
    }
    const providerOptions = [
      ['openai','OpenAI'],['deepseek','DeepSeek'],['mistral','Mistral'],
      ['anthropic','Anthropic'],['gemini','Gemini'],['grok','Grok'],
      ['opencodezen','OpenCode Zen'],['opencodego','OpenCode Go'],['ollama','Ollama'],['lmstudio','LM Studio'],
      ['localai','LocalAI'],['openrouter','OpenRouter'],['custom','Custom']
    ];
    const modelSuggestions = {
      openai: ['gpt-5.5','gpt-5.4-mini','gpt-5','gpt-5-mini','gpt-4.1','gpt-4.1-mini','gpt-4o','gpt-4o-mini','o3-pro','o3','o4-mini','o3-mini'],
      deepseek: ['deepseek-chat','deepseek-coder','deepseek-reasoner'],
      mistral: ['mistral-large-latest','mistral-medium-latest','mistral-small-latest','ministral-3b-latest','devstral-2.0','devstral-1.0','codestral-latest','codestral-mamba-latest'],
      anthropic: ['claude-opus-4-8','claude-opus-4-7','claude-opus-4-6','claude-sonnet-5','claude-sonnet-4-6'],
      gemini: ['gemini-3.5-flash','gemini-3.1-pro-preview','gemini-3.1-flash-lite','gemini-2.5-flash','gemini-2.5-pro'],
      grok: ['grok-4.3','grok-4.20','grok-build-0.1'],
      opencodezen: ['big-pickle','gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna','gpt-5.5','gpt-5.5-pro','gpt-5.4','gpt-5.4-pro','gpt-5.4-mini','gpt-5.4-nano','gpt-5.3-codex','gpt-5','gpt-5-nano','claude-fable-5','claude-opus-5','claude-sonnet-5','claude-haiku-4-5','gemini-3.7-flash','gemini-3.1-pro','gemini-3-flash','gemini-3.5-flash-lite','muse-spark-1.2','grok-4.6','grok-4.5','grok-build-0.1','kimi-k3','kimi-k2.7-code','kimi-k2.6','qwen3.7-max','qwen3.7-plus','minimax-m3','glm-5.2','deepseek-v4-pro','deepseek-v4-flash','nemotron-3-ultra-free','mimo-v2.5-free','hy3-free','x-preview-f-free'],
      opencodego: ['deepseek-v4-flash','deepseek-v4-pro','deepseek-v4-flash-vision-exp','grok-4.5','glm-5.3','glm-5.2','glm-5.1','gpt-5.6-luna','kimi-k3','kimi-k2.7-code','kimi-k2.6','longcat-2.0','mimo-v2.5','mimo-v2.5-pro','minimax-m3','minimax-m2.7','muse-spark-1.2-contributor','qwen3.8-max','qwen3.7-max','qwen3.7-plus','qwen3.6-plus','hy3','ox-alpha-free'],
      openrouter: ['anthropic/claude-sonnet-4-6','openai/gpt-4o','google/gemini-2.5-flash','meta-llama/llama-3.1-70b','mistralai/mistral-large'],
    };
    container.innerHTML = this._routes.map(route => {
      const isActive = route.id === this._activeRouteId;
      const isLocal = ['ollama','lmstudio','localai'].includes(route.provider);
      const models = modelSuggestions[route.provider] || [];
      const modelOptions = models.map(m => `<option value="${m}"${m===route.model?' selected':''}>${m}</option>`).join('');
      return `<div class="ai-router-route" style="background:${isActive?'var(--bg3)':'var(--bg2)'};border:1px solid ${isActive?'var(--accent)':'var(--border)'};border-radius:8px;padding:0.6rem;display:flex;flex-direction:column;gap:0.4rem;">
        <div style="display:flex;align-items:center;gap:0.4rem;">
          <input type="text" value="${this._esc(route.name)}" data-id="${route.id}" data-field="name" class="ai-router-input" style="flex:1;min-width:120px;padding:0.3rem 0.5rem;background:var(--bg1);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.8rem;" placeholder="Route name">
          <select data-id="${route.id}" data-field="provider" class="ai-router-select" style="padding:0.3rem;background:var(--bg1);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
            ${providerOptions.map(([v,l]) => `<option value="${v}"${v===route.provider?' selected':''}>${l}</option>`).join('')}
          </select>
          ${models.length > 0 ? `<select data-id="${route.id}" data-field="model" class="ai-router-select" style="padding:0.3rem;background:var(--bg1);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;max-width:180px;">${modelOptions}</select>` : `<input type="text" value="${this._esc(route.model)}" data-id="${route.id}" data-field="model" class="ai-router-input" style="width:140px;padding:0.3rem 0.5rem;background:var(--bg1);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;" placeholder="Model">`}
          <button data-id="${route.id}" data-action="activate" class="btn btn-sm ${isActive?'btn-primary':'btn-secondary'}" style="font-size:0.7rem;white-space:nowrap;">${isActive?'✓ Active':'Use'}</button>
          <button data-id="${route.id}" data-action="delete" class="btn btn-sm btn-secondary" style="font-size:0.7rem;color:var(--danger);">✕</button>
        </div>
        <div style="display:flex;gap:0.4rem;align-items:center;">
          ${isLocal ? `<input type="text" value="${this._esc(route.url || '')}" data-id="${route.id}" data-field="url" class="ai-router-input" style="flex:1;padding:0.3rem 0.5rem;background:var(--bg1);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;" placeholder="URL (e.g. http://localhost:11434)">` : `<input type="password" value="${this._esc(route.key || '')}" data-id="${route.id}" data-field="key" class="ai-router-input" style="flex:1;padding:0.3rem 0.5rem;background:var(--bg1);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;" placeholder="API Key">`}
          <span style="font-size:0.7rem;color:var(--text3);">Temp:</span>
          <input type="number" value="${route.temperature || 0.7}" data-id="${route.id}" data-field="temperature" class="ai-router-input" style="width:50px;padding:0.3rem;background:var(--bg1);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;" min="0" max="2" step="0.1">
        </div>
      </div>`;
    }).join('');
    container.querySelectorAll('.ai-router-input, .ai-router-select').forEach(el => {
      el.addEventListener('change', () => this.updateRoute(el.dataset.id, el.dataset.field, el.value));
    });
    container.querySelectorAll('[data-action="activate"]').forEach(btn => {
      btn.addEventListener('click', () => { this.setActive(btn.dataset.id); this.renderRoutes(); });
    });
    container.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => { this.removeRoute(btn.dataset.id); });
    });
  },
};

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

(async () => { if (typeof I18n !== 'undefined') { await I18n.init(); await I18n.applyToPage(); } })();

try { AIRouter.init(); } catch(e) { console.warn('AIRouter init error:', e); }
try { TaskRouter.init(); } catch(e) { console.warn('TaskRouter init error:', e); }

showStartMenu();

require.config({ paths: { vs: '../node_modules/monaco-editor/min/vs' } });
require(['vs/editor/editor.main'], () => {
  monacoReady = true;
  const container = document.getElementById('editor-container');
  if (container) {
    editor = monaco.editor.create(container, {
      theme: currentTheme === 'light' ? 'vs' : 'vs-dark',
      automaticLayout: true,
      fontSize: 13,
      readOnly: false,
      domReadOnly: false,
      minimap: { enabled: false },
      wordWrap: 'on',
      lineNumbers: 'on',
      renderLineHighlight: 'line',
      scrollBeyondLastLine: false,
      padding: { top: 8, bottom: 8 },
    });
    EditorMode.onModeChange = applyModeToLayout;
    applyModeToLayout(EditorMode.getMode());
    EditorMode.onAction = handleEditorAction;
    initInlineDiffHover();

    // Restore active tab if one was opened before Monaco was ready
    if (activeTabIndex >= 0 && activeTabIndex < openTabs.length) {
      const name = openTabs[activeTabIndex];
      const model = monaco.editor.getModels().find(m => m.uri.path === '/' + name);
      if (model) {
        editor.setModel(model);
      } else {
        const lang = tabLanguages[name] || detectLanguage(name);
        const uri = monaco.Uri.parse('file:///' + name);
        const newModel = monaco.editor.createModel(tabContents[name] || '', lang, uri);
        editor.setModel(newModel);
      }
    }
  }
});

// ==================== MODE TOGGLE + INLINE DIFF ====================

const inlineDiffStates = {};
let inlineDiffDecoIds = [];
let inlineDiffDecoModel = null;

function applyModeToLayout(mode) {
  const body = document.body;
  body.classList.toggle('app-mode-editor', mode === 'editor');
  body.classList.toggle('app-mode-chat', mode === 'chat');
  const btnE = document.getElementById('btn-mode-editor');
  const btnC = document.getElementById('btn-mode-chat');
  if (btnE) btnE.classList.toggle('active', mode === 'editor');
  if (btnC) btnC.classList.toggle('active', mode === 'chat');

  try {
    const api = (typeof LayoutManager !== 'undefined' && LayoutManager._api) || null;
    if (api) {
      const editorP = api.getPanel('editor');
      const chatP = api.getPanel('chat');
      if (mode === 'chat') {
        if (editorP) editorP.api.setVisible(false);
        if (chatP) { chatP.api.setVisible(true); chatP.api.setActive(); }
      } else {
        if (editorP) { editorP.api.setVisible(true); editorP.api.setActive(); }
        if (chatP) { chatP.api.setVisible(true); chatP.api.setSize({ width: 320 }); }
      }
    }
  } catch (e) {
    console.warn('applyModeToLayout dockview error:', e);
  }
}

document.getElementById('btn-mode-editor')?.addEventListener('click', () => EditorMode.setMode('editor'));
document.getElementById('btn-mode-chat')?.addEventListener('click', () => EditorMode.setMode('chat'));

function handleEditorAction(action, ctx) {
  if (!editor || !editor.getModel()) return;
  const fileName = getActiveFileName() || 'unknown';
  const sel = editor.getSelection();
  const text = ctx.text || (editor.getModel().getValueInRange(sel) || '');
  if (!text.trim()) return;
  const lang = ctx.lang || tabLanguages[fileName] || detectLanguage(fileName) || '';
  if (action === 'whatis' || action === 'explain') {
    sendMessage(EditorMode._buildPrompt(action, { text, lang, fileName }));
    return;
  }
  let goal = '';
  if (action === 'improve') {
    const g = prompt('Improvement goal (optional):', '');
    if (g === null) return;
    goal = g;
  } else if (action === 'change') {
    const g = prompt('What should be changed?:', '');
    if (g === null) return;
    goal = g;
  }
  const promptText = EditorMode._buildPrompt(action, { text, lang, fileName, goal });
  sendMessage(promptText);
}

function applyInlineDiffToEditor(fileName, newContent) {
  if (!editor || !editor.getModel()) return;
  if (fileName !== (getActiveFileName() || '')) return;
  const originalText = editor.getModel().getValue();
  inlineDiffStates[fileName] = createDiffState(fileName, originalText, newContent);
  editor.getModel().setValue(newContent);
  renderInlineDiffDecorations(fileName);
}

function renderInlineDiffDecorations(fileName) {
  if (!editor || !editor.getModel()) return;
  const model = editor.getModel();
  if (inlineDiffDecoModel !== model) {
    inlineDiffDecoIds = [];
    inlineDiffDecoModel = model;
  }
  const state = inlineDiffStates[fileName];
  if (!state) { inlineDiffDecoIds = editor.deltaDecorations(inlineDiffDecoIds, []); return; }
  const hunks = computeHunks(state.originalText, state.currentText);
  const lineCount = editor.getModel().getLineCount();
  const decos = [];
  hunks.forEach(h => {
    const pendingAdded = h.added.filter(x => !state.accepted.has(x.text));
    pendingAdded.forEach(x => {
      decos.push({
        range: new monaco.Range(x.line, 1, x.line, 1),
        options: {
          isWholeLine: true,
          className: 'inline-diff-added',
          linesDecorationsClassName: 'inline-diff-added-gutter',
          glyphMargin: true,
          glyphMarginClassName: 'inline-diff-glyph'
        }
      });
    });
    if (h.added.length === 0 && h.removed.length > 0) {
      const dl = Math.max(1, Math.min(h.startLine, lineCount));
      decos.push({
        range: new monaco.Range(dl, 1, dl, 1),
        options: { isWholeLine: true, className: 'inline-diff-removed', linesDecorationsClassName: 'inline-diff-removed-gutter' }
      });
    }
  });
  inlineDiffDecoIds = editor.deltaDecorations(inlineDiffDecoIds, decos);
}

function findHunkAtLine(state, lineNo) {
  const hunks = computeHunks(state.originalText, state.currentText);
  const lineCount = editor.getModel().getLineCount();
  return hunks.find(h =>
    h.added.some(x => x.line === lineNo) ||
    (h.removed.length > 0 && h.added.length === 0 && lineNo === Math.max(1, Math.min(h.startLine, lineCount)))
  );
}

function initInlineDiffHover() {
  if (!editor) return;
  editor.onMouseDown((e) => {
    const fileName = getActiveFileName();
    const state = fileName ? inlineDiffStates[fileName] : null;
    if (!state || !e.target || !e.target.position) { hideHunkToolbar(); return; }
    const lineNo = e.target.position.lineNumber;
    const hunk = findHunkAtLine(state, lineNo);
    if (hunk) showHunkToolbar(fileName, hunk);
    else hideHunkToolbar();
  });
  editor.onDidChangeCursorPosition((e) => {
    const fileName = getActiveFileName();
    const state = fileName ? inlineDiffStates[fileName] : null;
    const bar = document.getElementById('hunk-toolbar');
    if (!state || !e.position) { hideHunkToolbar(); return; }
    const hunk = findHunkAtLine(state, e.position.lineNumber);
    if (hunk) showHunkToolbar(fileName, hunk);
    else if (bar && bar.style.display === 'flex') hideHunkToolbar();
  });
  editor.onDidChangeCursorSelection((e) => {
    const sel = e.selection;
    if (sel && !sel.isEmpty() && editor.getModel()) {
      const fileName = getActiveFileName() || 'unknown';
      const lang = tabLanguages[fileName] || detectLanguage(fileName) || '';
      const text = editor.getModel().getValueInRange(sel);
      const pos = editor.getScrolledVisiblePosition(sel.getStartPosition());
      const editorDom = document.getElementById('editor-container');
      const editorRect = editorDom ? editorDom.getBoundingClientRect() : { top: 0, left: 0 };
      EditorMode.showSelectionMenu(sel, {
        text, lang, fileName,
        position: { left: editorRect.left + (pos ? pos.left : 0) + 10, top: editorRect.top + (pos ? pos.top : 0) - 40 }
      });
    } else {
      const existing = document.getElementById('editor-action-menu');
      if (existing) existing.remove();
    }
  });
}

function showHunkToolbar(fileName, hunk) {
  let bar = document.getElementById('hunk-toolbar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'hunk-toolbar'; document.body.appendChild(bar); }
  bar.innerHTML =
    '<button class="ht-btn" data-k="accept">Accept</button>' +
    '<button class="ht-btn" data-k="reject">Reject</button>' +
    '<button class="ht-btn" data-k="acceptLine">Accept Line</button>' +
    '<button class="ht-btn" data-k="rejectLine">Reject Line</button>' +
    '<button class="ht-btn" data-k="acceptAll">Accept All</button>' +
    '<button class="ht-btn" data-k="rejectAll">Reject All</button>';
  const pos = editor.getScrolledVisiblePosition({ lineNumber: hunk.added[0] ? hunk.added[0].line : hunk.startLine, column: 1 });
  const editorDom = document.getElementById('editor-container');
  const rect = editorDom ? editorDom.getBoundingClientRect() : { top: 0, left: 0 };
  bar.style.left = (rect.left + (pos ? pos.left : 0) + 10) + 'px';
  bar.style.top = (rect.top + (pos ? pos.top : 0) - 40) + 'px';
  bar.style.display = 'flex';
  bar.onclick = (ev) => {
    const b = ev.target.closest('.ht-btn');
    if (!b) return;
    if (b.dataset.k === 'accept') applyHunkDecision(fileName, hunk.id, 'accept');
    else if (b.dataset.k === 'reject') applyHunkDecision(fileName, hunk.id, 'reject');
    else if (b.dataset.k === 'acceptLine') applyHunkDecision(fileName, hunk.id, 'acceptLine', hunk.added[0] && hunk.added[0].line);
    else if (b.dataset.k === 'rejectLine') applyHunkDecision(fileName, hunk.id, 'rejectLine', hunk.added[0] && hunk.added[0].line);
    else if (b.dataset.k === 'acceptAll') commitCurrentFile();
    else if (b.dataset.k === 'rejectAll') rejectCurrentFile();
  };
}

function hideHunkToolbar() {
  const bar = document.getElementById('hunk-toolbar');
  if (bar) bar.style.display = 'none';
}

function applyHunkDecision(fileName, hunkId, kind, lineNo) {
  const state = inlineDiffStates[fileName];
  if (!state) return;
  let next;
  if (kind === 'accept') { next = acceptHunk(state, hunkId); }
  else if (kind === 'reject') { next = rejectHunk(state, hunkId).state; }
  else if (kind === 'acceptLine') { next = acceptLine(state, hunkId, lineNo); }
  else if (kind === 'rejectLine') { next = rejectLine(state, hunkId, lineNo).state; }
  if (next === state) return;
  inlineDiffStates[fileName] = next;
  if (kind === 'reject' || kind === 'rejectLine') {
    if (editor && editor.getModel()) editor.getModel().setValue(next.currentText);
    persistEditorToDisk(fileName);
  }
  renderInlineDiffDecorations(fileName);
  hideHunkToolbar();
}

function persistEditorToDisk(fileName) {
  if (!currentProject || !editor || !editor.getModel()) return;
  const content = editor.getModel().getValue();
  tabContents[fileName] = content;
  tabDirty[fileName] = false;
  window.electronAPI.projectWriteFile(currentProject, fileName, content).catch(() => {});
  renderTabs();
}

function commitCurrentFile() {
  const fileName = getActiveFileName();
  if (!fileName || !inlineDiffStates[fileName]) return;
  inlineDiffDecoIds = editor.deltaDecorations(inlineDiffDecoIds, []);
  delete inlineDiffStates[fileName];
  hideHunkToolbar();
  logToTerminal('Changes applied (already saved).', 'success');
}

function rejectCurrentFile() {
  const fileName = getActiveFileName();
  if (!fileName || !inlineDiffStates[fileName]) return;
  const state = inlineDiffStates[fileName];
  const r = rejectAll(state);
  if (editor && editor.getModel()) editor.getModel().setValue(r.state.currentText);
  inlineDiffDecoIds = editor.deltaDecorations(inlineDiffDecoIds, []);
  delete inlineDiffStates[fileName];
  persistEditorToDisk(fileName);
  hideHunkToolbar();
  logToTerminal('All changes discarded, original restored.', 'info');
}

function showOptimizePrompt(code, lang, fileName) {
  const existing = document.getElementById('optimize-prompt-modal');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'optimize-prompt-modal';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);';
  overlay.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:1.5rem;width:500px;max-width:90vw;box-shadow:0 8px 32px rgba(0,0,0,0.4);">
      <h3 style="margin:0 0 0.5rem;font-size:1rem;">Code Optimizer</h3>
      <p style="font-size:0.8rem;color:var(--text3);margin-bottom:1rem;">
        What would you like to improve in this code section?
      </p>
      <textarea id="optimize-input" rows="3" placeholder="e.g. improve performance, make more readable, fix bugs, convert to TypeScript..."
        style="width:100%;padding:0.5rem;background:var(--bg3);color:var(--text1);border:1px solid var(--border);border-radius:4px;font-size:0.8rem;resize:vertical;box-sizing:border-box;"></textarea>
      <div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-top:1rem;">
        <button id="optimize-cancel" class="btn btn-sm btn-secondary">Cancel</button>
        <button id="optimize-confirm" class="btn btn-sm btn-primary">Optimize</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('optimize-input').focus();
  document.getElementById('optimize-cancel').onclick = () => overlay.remove();
  document.getElementById('optimize-confirm').onclick = () => {
    const goal = document.getElementById('optimize-input').value.trim();
    overlay.remove();
    if (goal) {
      sendMessage('Optimize the following code section. Goal: ' + goal + '\n\n```' + lang + '\n' + code + '\n```\n\nShow me the optimized code and explain the changes.');
    } else {
      sendMessage('Optimize the following code section for performance and readability.\n\n```' + lang + '\n' + code + '\n```\n\nShow me the optimized code and explain the changes.');
    }
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

async function searchCodeOnline(code, lang, fileName) {
  ManagementPanel.show('ci');
  const tabs = document.getElementById('ci-tabs');
  const results = document.getElementById('ci-results');
  if (results) results.innerHTML = 'Searching...';
  const iso = typeof CodeIntelligence !== 'undefined' ? CodeIntelligence : null;
  if (iso) iso._activeTab = 'code-search';

  const q = encodeURIComponent(code.trim().slice(0, 200));
  let output = '<div style="padding:0.75rem;font-size:0.8rem;color:var(--text2);">Searching for similar code...</div>';

  // searchcode.com
  try {
    const r = await fetch('https://api.searchcode.com/api/v1/search/?q=' + q, { signal: AbortSignal.timeout(15000) });
    const data = await r.json();
    if (data.results?.length > 0) {
      output = '<div style="padding:0.75rem;"><div style="margin-bottom:0.5rem;font-weight:500;font-size:0.85rem;">🔍 Repo Search (searchcode)</div>' +
        data.results.slice(0, 12).map(item => `
          <div style="padding:0.4rem 0;border-bottom:1px solid var(--border);">
            <a href="${escapeHtml(item.url)}" target="_blank" style="color:var(--accent);text-decoration:none;font-weight:500;">${escapeHtml(item.name)}</a>
            <div style="color:var(--text3);font-size:0.7rem;">${escapeHtml(item.filename || '')} — ${escapeHtml(item.language || '')}</div>
            <pre style="background:var(--bg3);padding:0.3rem;border-radius:4px;font-size:0.65rem;overflow:hidden;margin-top:0.2rem;">${escapeHtml((item.code || '').slice(0, 250))}</pre>
          </div>
        `).join('') + '</div>';
    } else {
      output = '<div style="padding:0.75rem;color:var(--text3);font-size:0.8rem;">No results found on searchcode.com.</div>';
    }
  } catch (e) {
    output = '<div style="padding:0.75rem;color:var(--text3);font-size:0.8rem;">searchcode.com Error: ' + (e.message || 'Network error') + '</div>';
  }

  // PublicWWW if connected
  const pubKey = typeof ApiKeyManager !== 'undefined' ? ApiKeyManager.getKey('publicwww') : '';
  if (pubKey) {
    try {
      const q2 = encodeURIComponent(code.trim().slice(0, 100));
      const r = await fetch('https://publicwww.com/websites/' + q2 + '/?key=' + encodeURIComponent(pubKey) + '&export=csvsnippets', {
        headers: { 'Accept': 'text/csv' }, signal: AbortSignal.timeout(20000)
      });
      const text = await r.text();
      if (text.trim()) {
        const lines = text.trim().split('\n').slice(0, 15);
        output += '<div style="padding:0 0.75rem 0.75rem;"><hr style="border:none;border-top:1px solid var(--border);margin:0.5rem 0;"><div style="margin-bottom:0.5rem;font-weight:500;font-size:0.85rem;">🌐 Web Search (PublicWWW)</div>' +
          lines.map(line => `<div style="padding:0.2rem 0;border-bottom:1px solid var(--border);font-size:0.7rem;word-break:break-all;">${line}</div>`).join('') + '</div>';
      }
    } catch {}
  }

  if (results) results.innerHTML = output;
}

// ==================== DIFF VIEWER (READ-ONLY) ====================

const DiffViewer = {
  _files: [],
  _activeFile: null,
  _editor: null,
  _model: null,

  show(files) {
    if (!files || files.length === 0) return;
    for (const f of files) {
      const existing = this._files.findIndex(x => x.name === f.name);
      if (existing >= 0) {
        this._files[existing] = f;
      } else {
        this._files.push(f);
      }
    }
    this._activeFile = files[files.length - 1].name;
    const el = document.getElementById('diff-viewer');
    el.classList.remove('hidden');
    el.classList.add('visible');
    this._renderTabs();
    const btn = document.getElementById('btn-toggle-diff');
    if (btn) btn.classList.remove('hidden');
    // Defer editor creation so container is visible for Monaco layout
    requestAnimationFrame(() => this._createEditor());
  },

  hide() {
    this._disposeEditor();
    this._files = [];
    this._activeFile = null;
    const el = document.getElementById('diff-viewer');
    el.classList.remove('visible');
    el.classList.add('hidden');
    document.getElementById('diff-viewer-tabs').innerHTML = '';
  },

  _renderTabs() {
    const bar = document.getElementById('diff-viewer-tabs');
    bar.innerHTML = this._files.map(f => {
      const short = f.name.split('/').pop();
      const active = f.name === this._activeFile ? ' active' : '';
      return `<div class="diff-viewer-tab${active}" data-file="${f.name}">${short}</div>`;
    }).join('');
    bar.querySelectorAll('.diff-viewer-tab').forEach(tab => {
      tab.addEventListener('click', () => this._switchFile(tab.dataset.file));
    });
  },

  _switchFile(name) {
    this._activeFile = name;
    this._renderTabs();
    requestAnimationFrame(() => this._createEditor());
  },

  _disposeEditor() {
    if (this._model) { this._model.dispose(); this._model = null; }
    if (this._editor) { this._editor.dispose(); this._editor = null; }
  },

  _createEditor() {
    if (!monacoReady) return;
    this._disposeEditor();
    const file = this._files.find(f => f.name === this._activeFile);
    if (!file) return;
    const container = document.getElementById('diff-viewer-content');
    container.innerHTML = '';
    const lang = file.language || detectLanguage(file.name);
    const model = monaco.editor.createModel(file.content || '', lang);
    this._model = model;
    this._editor = monaco.editor.create(container, {
      model: model,
      theme: currentTheme === 'light' ? 'vs' : 'vs-dark',
      automaticLayout: true,
      fontSize: 13,
      scrollBeyondLastLine: false,
      readOnly: true,
      domReadOnly: true,
      minimap: { enabled: false },
      wordWrap: 'on',
      lineNumbers: 'on',
      renderLineHighlight: 'none',
      overviewRulerBorder: false,
      scrollbar: { vertical: 'auto', horizontal: 'auto' },
      padding: { top: 8, bottom: 8 },
    });
  },
};

// ==================== EXECUTION MANAGER (Manus-style) ====================

const ExecutionManager = {
  _queue: [],
  _running: false,
  _currentTask: null,
  _history: [],

  init() {
    this._loadHistory();
    document.getElementById('btn-exec-toggle')?.addEventListener('click', () => this.togglePanel());
    document.getElementById('btn-exec-close')?.addEventListener('click', () => this.hidePanel());
    document.getElementById('btn-exec-clear')?.addEventListener('click', () => {
      this._history = [];
      this._saveHistory();
      this._render();
    });
  },

  togglePanel() {
    const panel = document.getElementById('execution-panel');
    panel?.classList.toggle('hidden');
    if (!panel?.classList.contains('hidden')) this._render();
  },

  hidePanel() {
    document.getElementById('execution-panel')?.classList.add('hidden');
  },

  async executeGoal(goal, steps) {
    const execution = {
      id: 'exec-' + Date.now(),
      goal,
      steps: steps || [],
      status: 'running',
      currentStep: 0,
      startedAt: Date.now(),
      completedAt: null,
      results: []
    };
    this._queue.push(execution);
    this._history.push(execution);
    this._saveHistory();
    this._render();
    this._showNotification(execution);

    const panel = document.getElementById('execution-panel');
    if (panel?.classList.contains('hidden')) this.togglePanel();

    if (!steps || steps.length === 0) {
      execution.steps = await this._decomposeGoal(goal);
    }

    this._running = true;
    for (let i = 0; i < execution.steps.length; i++) {
      if (!this._running) break;
      execution.currentStep = i;
      const step = execution.steps[i];
      this._render();

      const chat = document.getElementById('chat-messages');
      if (chat) {
        const div = document.createElement('div');
        div.className = 'chat-msg system exec-step';
        div.innerHTML = `<strong>Step ${i + 1}/${execution.steps.length}:</strong> ${this._escapeHtml(step)}`;
        chat.appendChild(div);
        chat.scrollTop = chat.scrollHeight;
      }

      await this._executeStep(execution, i);

      await new Promise(r => setTimeout(r, 1000));
    }

    execution.status = this._running ? 'completed' : 'cancelled';
    execution.completedAt = Date.now();
    this._running = false;
    this._saveHistory();
    this._render();

    const chat = document.getElementById('chat-messages');
    if (chat) {
      const div = document.createElement('div');
      div.className = 'chat-msg system exec-done';
      div.innerHTML = execution.status === 'completed'
        ? '<strong>Goal completed:</strong> ' + this._escapeHtml(goal)
        : '<strong>Execution cancelled:</strong> ' + this._escapeHtml(goal);
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
    }
  },

  async _decomposeGoal(goal) {
    const steps = [
      'Analyze requirements: ' + goal,
      'Plan the implementation approach',
      'Implement the solution',
      'Test and verify the implementation'
    ];
    return steps;
  },

  async _executeStep(execution, stepIndex) {
    const step = execution.steps[stepIndex];
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('btn-send') || document.querySelector('[data-action="send"]');
    if (input && sendBtn) {
      input.value = `[Execution Step ${stepIndex + 1}/${execution.steps.length}]: ${step}`;
      sendBtn.click();
      await new Promise(r => setTimeout(r, 2000));
      while (document.querySelector('.chat-activity') || document.querySelector('.thinking')) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  },

  cancel() {
    this._running = false;
    if (this._currentTask) {
      if (typeof cancelRequestWithTimeout === 'function') {
        cancelRequestWithTimeout('Execution cancelled by user.');
      }
    }
    this._render();
  },

  _render() {
    const container = document.getElementById('execution-list');
    if (!container) return;

    const running = this._queue.find(e => e.status === 'running');
    if (running) {
      container.innerHTML = `
        <div class="exec-current">
          <div class="exec-header">${this._escapeHtml(running.goal)}</div>
          <div class="exec-progress">
            <div class="exec-progress-bar" style="width:${((running.currentStep + 1) / running.steps.length * 100)}%"></div>
          </div>
          <div class="exec-step-label">Step ${running.currentStep + 1} of ${running.steps.length}</div>
          <div class="exec-steps">
            ${running.steps.map((s, i) => `
              <div class="exec-step-item ${i < running.currentStep ? 'done' : i === running.currentStep ? 'active' : ''}">
                ${i < running.currentStep ? '+' : i === running.currentStep ? '>' : '-'}
                ${this._escapeHtml(s)}
              </div>
            `).join('')}
          </div>
          <button class="btn btn-sm btn-secondary" id="btn-exec-cancel" style="margin-top:0.5rem;">Cancel</button>
        </div>
      `;
      document.getElementById('btn-exec-cancel')?.addEventListener('click', () => this.cancel());
    } else {
      const recent = this._history.slice(-10).reverse();
      container.innerHTML = recent.length
        ? recent.map(e => `
          <div class="exec-history-item">
            <span class="exec-status-icon">${e.status === 'completed' ? '+' : e.status === 'cancelled' ? 'x' : '!'}</span>
            <span class="exec-goal">${this._escapeHtml(e.goal)}</span>
            <span class="exec-time">${new Date(e.completedAt || e.startedAt).toLocaleTimeString()}</span>
          </div>
        `).join('')
        : '<div style="padding:1rem;text-align:center;color:var(--text3);font-size:0.8rem;">No executions yet</div>';
    }

    const badge = document.getElementById('exec-badge');
    if (badge) {
      const active = this._queue.filter(e => e.status === 'running').length;
      badge.textContent = active > 0 ? active : '';
      badge.style.display = active > 0 ? 'flex' : 'none';
    }
  },

  _showNotification(exec) {
    showNotification('info', 'Execution started: ' + exec.goal, 'info');
  },

  _loadHistory() {
    try {
      const data = localStorage.getItem('florde-exec-history');
      if (data) this._history = JSON.parse(data);
    } catch { this._history = []; }
  },

  _saveHistory() {
    try {
      localStorage.setItem('florde-exec-history', JSON.stringify(this._history.slice(-50)));
    } catch {}
  },

  _escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
};

ExecutionManager.init();

// Diff viewer toggle button
document.getElementById('btn-toggle-diff')?.addEventListener('click', () => {
  const el = document.getElementById('diff-viewer');
  if (el.classList.contains('visible')) {
    DiffViewer.hide();
  } else if (DiffViewer._files.length > 0) {
    el.classList.remove('hidden');
    el.classList.add('visible');
    DiffViewer._renderTabs();
    DiffViewer._createEditor();
  }
});

// Diff viewer close button
document.getElementById('btn-close-diff')?.addEventListener('click', () => {
  DiffViewer.hide();
});

// ==================== SUBAGENTS OVERLAY ====================

function initSubagentsOverlay() {
  const btn = document.getElementById('btn-subagents');
  const modal = document.getElementById('subagents-modal');
  const closeBtn = document.getElementById('btn-subagents-close');
  const abortAllBtn = document.getElementById('btn-subagents-abort-all');
  const list = document.getElementById('subagents-list');

  if (!btn || !modal) return;

  btn.addEventListener('click', () => {
    modal.classList.remove('hidden');
    renderSubagentsList();
  });

  closeBtn?.addEventListener('click', () => modal.classList.add('hidden'));

  abortAllBtn?.addEventListener('click', () => {
    if (confirm('Cancel all subagents?')) {
      window.SubagentManager?.abortAll();
      renderSubagentsList();
    }
  });

  // Close on background click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  // Register live streaming callback
  window._subagentLiveCallback = (id, type, data) => {
    renderSubagentsList();
  };

  // Poll every 2s for live updates (falls callback missed)
  setInterval(() => {
    if (!modal.classList.contains('hidden')) {
      renderSubagentsList();
    }
  }, 2000);
}

function renderSubagentsList() {
  const list = document.getElementById('subagents-list');
  if (!list || !window.SubagentManager) return;

  const instances = window.SubagentManager.getAll();
  if (instances.length === 0) {
    list.innerHTML = '<div style="color:var(--text3);text-align:center;padding:2rem;">No active subagents</div>';
    return;
  }

  list.innerHTML = instances.map(inst => {
    const statusLabel = inst.status.charAt(0).toUpperCase() + inst.status.slice(1);
    const timeAgo = Math.floor((Date.now() - inst.createdAt) / 1000);
    const timeStr = timeAgo < 60 ? `${timeAgo}s ago` : `${Math.floor(timeAgo / 60)}m ago`;
    const output = inst._messages.slice(-5).map(m =>
      (m.role === 'user' ? '> ' : '') + m.content.slice(0, 200)
    ).join('\n---\n');

    return `<div class="subagent-card ${inst.status}">
      <div class="subagent-card-header">
        <span><span class="subagent-card-id">${inst.id}</span> <span class="subagent-card-goal">${escapeHtml(inst.goal.slice(0, 60))}</span></span>
        <span class="subagent-card-status ${inst.status}">${statusLabel} · ${timeStr}</span>
      </div>
      <div class="subagent-card-output">${escapeHtml(output || '(no output)')}</div>
    </div>`;
  }).join('');
}

// Init on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSubagentsOverlay);
} else {
  initSubagentsOverlay();
}
