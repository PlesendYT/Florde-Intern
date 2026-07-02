// ==================== DYNAMIC TOOLS ====================

function getActiveTools() {
  const baseTools = [
    { type: 'function', function: { name: 'read_file', description: 'Read a file from the project', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to project root' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'write_file', description: 'Create or overwrite a file in the project', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to project root' }, content: { type: 'string', description: 'Full file content' } }, required: ['path', 'content'] } } },
    { type: 'function', function: { name: 'delete_file', description: 'Delete a file from the project', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to project root' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'list_files', description: 'List all files in the project', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'search_files', description: 'Search for text across all project files', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Text to search for' } }, required: ['query'] } } },
    { type: 'function', function: { name: 'exec_command', description: 'Execute a shell command in the project sandbox directory', parameters: { type: 'object', properties: { command: { type: 'string', description: 'Shell command to execute' } }, required: ['command'] } } },
  ];
  const pluginTools = typeof pluginRegistry !== 'undefined' ? pluginRegistry.getActiveTools() : [];
  return [...baseTools, ...pluginTools];
}

window.__updateTools = function() {
  if (typeof pluginRegistry !== 'undefined' && pluginRegistry._loaded) {
    if (document.getElementById('marketplace-list')) renderPluginMarketplace();
  }
};

// ==================== AI PROVIDERS ====================

function fetchWithTimeout(url, options, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

class OpenAIProvider {
  constructor(apiKey, model = 'gpt-4o') { this.apiKey = apiKey; this.model = model; this.baseUrl = 'https://api.openai.com/v1/chat/completions'; }
  async _post(url, body, timeoutMs = 60000) {
    const r = await fetchWithTimeout(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    }, timeoutMs);
    if (!r.ok) throw new Error(`${this.constructor.name} API error: ${r.status} ${r.statusText}`);
    return r;
  }
  async sendMessage(messages, onChunk) {
    const r = await this._post(this.baseUrl, { model: this.model, messages, stream: true }, 120000);
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
    const r = await this._post(this.baseUrl, { model: this.model, messages, tools, tool_choice: 'auto', stream: false });
    const data = await r.json();
    return data.choices?.[0]?.message || { content: '', role: 'assistant' };
  }
  async sendPlain(messages) {
    const r = await this._post(this.baseUrl, { model: this.model, messages, stream: false });
    const data = await r.json();
    return data.choices?.[0]?.message?.content || '';
  }
}

class DeepSeekProvider extends OpenAIProvider {
  constructor(apiKey, model = 'deepseek-chat') { super(apiKey, 'deepseek-chat'); this.apiKey = apiKey; this.model = model; this.baseUrl = 'https://api.deepseek.com/v1/chat/completions'; }
  async _post(url, body, timeoutMs = 60000) {
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
  async _post(url, body, timeoutMs = 60000) {
    const r = await fetchWithTimeout(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    }, timeoutMs);
    if (!r.ok) { const detail = await r.json().catch(() => ({})); throw new Error(`Mistral API error: ${r.status} ${detail.error?.message || r.statusText}`); }
    return r;
  }
}

class OllamaProvider {
  constructor(baseUrl = 'http://localhost:11434', model = 'codellama') { this.baseUrl = baseUrl.replace(/\/+$/, ''); this.model = model; }
  async _post(endpoint, body, timeoutMs = 120000) {
    const r = await fetchWithTimeout(`${this.baseUrl}${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, timeoutMs);
    if (!r.ok) throw new Error(`Ollama API error: ${r.status} ${r.statusText}`);
    return r;
  }
  async sendMessage(messages, onChunk) {
    const r = await this._post('/api/chat', { model: this.model, messages, stream: true });
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
  async sendWithTools(messages, tools) {
    const r = await this._post('/api/chat', { model: this.model, messages, tools, stream: false });
    const data = await r.json();
    const msg = data.message || {};
    return { content: msg.content || '', role: 'assistant', tool_calls: msg.tool_calls };
  }
  async sendPlain(messages) {
    const r = await this._post('/api/chat', { model: this.model, messages, stream: false });
    const data = await r.json();
    return data.message?.content || '';
  }
}

class GrokProvider extends OpenAIProvider {
  constructor(apiKey, model = 'grok-4.3') { super(apiKey, model); this.apiKey = apiKey; this.model = model; this.baseUrl = 'https://api.x.ai/v1/chat/completions'; }
}

class AnthropicProvider {
  constructor(apiKey, model = 'claude-sonnet-4-6') { this.apiKey = apiKey; this.model = model; }
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
    const body = { model: this.model, max_tokens: 8192, messages: msgs, stream: true };
    if (system) body.system = system;
    const r = await this._post('https://api.anthropic.com/v1/messages', body);
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
    const body = { model: this.model, max_tokens: 8192, messages: msgs };
    if (system) body.system = system;
    if (tools) body.tools = tools.map(t => t.function);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: await this._headers(),
      body: JSON.stringify(body),
    });
    const data = await r.json();
    return this._fromAnthropic(data);
  }
  async sendPlain(messages) {
    const { system, messages: msgs } = this._toAnthropic(messages);
    const body = { model: this.model, max_tokens: 8192, messages: msgs };
    if (system) body.system = system;
    const r = await this._post('https://api.anthropic.com/v1/messages', body);
    const data = await r.json();
    return this._fromAnthropic(data).content;
  }
}

class GeminiProvider {
  constructor(apiKey, model = 'gemini-2.5-flash') { this.apiKey = apiKey; this.model = model; }
  async _post(path, body, timeoutMs = 120000) {
    const r = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
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
    const r = await this._post(`streamGenerateContent?alt=sse&key=${this.apiKey}`, { contents });
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
    const r = await this._post(`generateContent?key=${this.apiKey}`, { contents });
    const data = await r.json();
    return this._fromGemini(data);
  }
  async sendPlain(messages) {
    const contents = this._toGemini(messages);
    const r = await this._post(`generateContent?key=${this.apiKey}`, { contents });
    const data = await r.json();
    return this._fromGemini(data).content;
  }
}

// ==================== STATE ====================

let providers = {};
let chatHistory = [];
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

// ==================== TOOLS ====================

// (tools now come from getActiveTools())

function buildSystemPrompt() {
  return `You are Florde AI, an AI coding assistant with direct access to the user's project files.

You can use the following tools:
- read_file(path): Read file content
- write_file(path, content): Create or overwrite files
- delete_file(path): Delete files
- list_files(): List all project files
- search_files(query): Find text in files
- exec_command(command): Run shell commands in the project directory

RULES:
1. Always start by listing files to understand the project structure
2. Read files before making changes
3. Use write_file to create or modify files — never just show the code
4. Use exec_command to install dependencies, run the project, etc.
5. After making changes, verify with exec_command if appropriate
6. Explain what you're doing at each step
7. Only modify files inside the project — do not access files outside

Project: ${currentProject}
Type: ${currentProjectType}
${currentProjectType === 'local' ? 'Notes: This is a local project. exec_command runs in the project root directory. You can use system commands (pip install, npm install, cargo build, etc.) to set up and run the project.' : 'Notes: This is a sandbox project. Files are stored in app data. exec_command runs in the isolated sandbox directory.'}

${getPluginPromptExtensions()}`;
}

function getPluginPromptExtensions() {
  if (typeof pluginRegistry === 'undefined') return '';
  const extensions = pluginRegistry.getActivePromptExtensions();
  return extensions.map((ext, i) => `--- Plugin Extension (${i + 1}) ---\n${ext}`).join('\n\n');
}

function getToolResultMsg(toolCallId, name, result) {
  return { role: 'tool', tool_call_id: toolCallId, content: String(result) };
}

// ==================== SETTINGS ====================

async function loadSettings() {
  const s = await window.electronAPI.getSettings();
  if (!s) return;
  if (s.openaiKey) { document.getElementById('key-openai').value = s.openaiKey; providers.openai = new OpenAIProvider(s.openaiKey, s.openaiModel || 'gpt-5.5'); }
  if (s.deepseekKey) { document.getElementById('key-deepseek').value = s.deepseekKey; providers.deepseek = new DeepSeekProvider(s.deepseekKey, s.deepseekModel || 'deepseek-chat'); }
  if (s.mistralKey) { document.getElementById('key-mistral').value = s.mistralKey; providers.mistral = new MistralProvider(s.mistralKey, s.mistralModel || 'mistral-large-latest'); }
  if (s.anthropicKey) { document.getElementById('key-anthropic').value = s.anthropicKey; providers.anthropic = new AnthropicProvider(s.anthropicKey, s.anthropicModel || 'claude-sonnet-4-6'); }
  if (s.geminiKey) { document.getElementById('key-gemini').value = s.geminiKey; providers.gemini = new GeminiProvider(s.geminiKey, s.geminiModel || 'gemini-2.5-flash'); }
  if (s.grokKey) { document.getElementById('key-grok').value = s.grokKey; providers.grok = new GrokProvider(s.grokKey, s.grokModel || 'grok-4.3'); }
  if (s.ollamaUrl) document.getElementById('url-ollama').value = s.ollamaUrl;
  if (s.ollamaModel) document.getElementById('model-ollama').value = s.ollamaModel;
  providers.ollama = new OllamaProvider(s.ollamaUrl || 'http://localhost:11434', s.ollamaModel || 'codellama');
  if (s.openaiModel) document.getElementById('model-openai').value = s.openaiModel;
  if (s.deepseekModel) document.getElementById('model-deepseek').value = s.deepseekModel;
  if (s.mistralModel) document.getElementById('model-mistral').value = s.mistralModel;
  if (s.anthropicModel) document.getElementById('model-anthropic').value = s.anthropicModel;
  if (s.geminiModel) document.getElementById('model-gemini').value = s.geminiModel;
  if (s.grokModel) document.getElementById('model-grok').value = s.grokModel;
  await initSandbox();
  try {
    const autoStart = await window.electronAPI.getAutoStart();
    document.getElementById('auto-start').checked = autoStart;
  } catch {}
  if (s.theme) { currentTheme = s.theme; applyTheme(); }
}

async function saveSettingsToDisk() {
  await window.electronAPI.saveSettings({
    openaiKey: document.getElementById('key-openai').value,
    openaiModel: document.getElementById('model-openai').value,
    deepseekKey: document.getElementById('key-deepseek').value,
    deepseekModel: document.getElementById('model-deepseek').value,
    mistralKey: document.getElementById('key-mistral').value,
    mistralModel: document.getElementById('model-mistral').value,
    anthropicKey: document.getElementById('key-anthropic').value,
    anthropicModel: document.getElementById('model-anthropic').value,
    geminiKey: document.getElementById('key-gemini').value,
    geminiModel: document.getElementById('model-gemini').value,
    grokKey: document.getElementById('key-grok').value,
    grokModel: document.getElementById('model-grok').value,
    ollamaUrl: document.getElementById('url-ollama').value,
    ollamaModel: document.getElementById('model-ollama').value,
    theme: currentTheme,
  });
  await window.electronAPI.setAutoStart(document.getElementById('auto-start').checked);
}

// ==================== THEME ====================

function applyTheme() {
  document.body.classList.toggle('light-theme', currentTheme === 'light');
  document.getElementById('btn-theme-toggle').textContent = currentTheme === 'light' ? '\u263D' : '\u2600';
  if (editor) {
    monaco.editor.setTheme(currentTheme === 'light' ? 'vs' : 'vs-dark');
  }
}

// ==================== SANDBOX ====================

async function initSandbox() {
  sandboxDir = await window.electronAPI.getSandboxDir();
  updateSandboxStatus();
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
    el.className = 'sandbox-status active';
  } else {
    el.textContent = 'No sandbox set';
    el.className = 'sandbox-status';
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

function showStartMenu() {
  document.getElementById('start-menu').classList.remove('hidden');
  document.getElementById('app-view').classList.add('hidden');
  loadProjectList();
}

function showAppView() {
  document.getElementById('start-menu').classList.add('hidden');
  document.getElementById('app-view').classList.remove('hidden');
}

async function loadProjectList() {
  const container = document.getElementById('project-items');
  const projects = await window.electronAPI.listProjects();
  container.innerHTML = '';
  document.getElementById('project-list').classList.remove('hidden');
  if (projects.length === 0) {
    container.innerHTML = '<div style="color:var(--text3);font-size:0.85rem;padding:0.5rem;">No projects yet</div>';
    return;
  }
  for (const p of projects) {
    const div = document.createElement('div');
    div.className = 'project-item';
    const typeLabel = p.type === 'local' ? 'Local' : 'Sandbox';
    div.innerHTML = `<span class="project-type">${typeLabel}</span><span style="flex:1">${p.name}</span><button class="project-del" data-name="${p.name}">&times;</button>`;
    div.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') openProject(p.name);
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
  setTimeout(() => document.getElementById('new-project-name').focus(), 100);
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
      openProject(name);
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
    openProject(name);
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
  chatHistory = session.history || [];

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
  logToTerminal(`Opened project: ${name} (${currentProjectType})`, 'success');

  if (chatHistory.length === 0) {
    const welcome = 'I\'m your AI coding assistant. I can help you write, explain, and debug code. ' +
      'Send me a message to get started!';
    chatHistory.push({ role: 'assistant', content: welcome });
    renderChat();
  }
}

// ==================== PLUGIN MARKETPLACE ====================

document.getElementById('btn-start-plugins').addEventListener('click', () => {
  document.getElementById('plugin-modal').classList.remove('hidden');
  renderPluginMarketplace();
});

document.getElementById('btn-plugins').addEventListener('click', () => {
  document.getElementById('plugin-modal').classList.remove('hidden');
  renderPluginMarketplace();
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
  await window.electronAPI.saveSession(currentProject, { history: chatHistory });
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

function switchTab(index) {
  if (activeTabIndex >= 0 && activeTabIndex < openTabs.length && editor) {
    tabContents[openTabs[activeTabIndex]] = editor.getValue();
    if (currentProjectType === 'local') saveCurrentFile();
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
  renderFileTree();
}

function closeTab(index) {
  if (openTabs.length <= 1) return;
  const name = openTabs[index];
  if (tabDirty[name] && !confirm(`"${name}" has unsaved changes. Close anyway?`)) return;
  if (currentProjectType === 'local') saveCurrentFile();
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
  renderFileTree();
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

document.getElementById('btn-sidebar-toggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('hidden');
});

document.getElementById('btn-new-file').addEventListener('click', async () => {
  const name = prompt('File name (e.g. script.py):');
  if (!name) return;
  if (openTabs.indexOf(name) >= 0) { switchTab(openTabs.indexOf(name)); return; }
  tabContents[name] = '';
  tabLanguages[name] = detectLanguage(name);
  tabDirty[name] = true;
  openTabs.push(name);
  switchTab(openTabs.length - 1);
  renderFileTree();
  logToTerminal(`Created file: ${name}`, 'success');
});

document.getElementById('btn-new-folder').addEventListener('click', async () => {
  const name = prompt('Folder name:');
  if (!name) return;
  logToTerminal(`Folder "${name}" will be created on first file save inside it`, 'info');
  renderFileTree();
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
    const label = msg.role === 'user' ? 'You' : 'Florde AI';
    const modelHint = msg.role === 'assistant' && msg.model ? ` · ${msg.model}` : '';
    div.innerHTML = `<div class="msg-label">${label}${modelHint} <button class="copy-msg" onclick="event.stopPropagation();navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(msg.content)}'))">Copy</button></div>` + formatMessageContent(msg.content);
    container.appendChild(div);
  }
  container.scrollTop = container.scrollHeight;
  updateTokenCount();
}

function formatMessageContent(content) {
  let html = content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  html = html.replace(/```file:([^\n]+)\n([\s\S]*?)```/g, (m, file, code) => {
    const id = 'fb-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const safeCode = code.replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `<div class="file-block" id="${id}"><span class="file-block-name">${file}</span><pre><code>${safeCode}</code></pre></div>`;
  });
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => {
    const safeCode = code.replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const langClass = lang ? ` class="lang-${lang}"` : '';
    return `<pre${langClass}><button class="copy-code" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(code)}'))">Copy</button><code>${safeCode}</code></pre>`;
  });
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\n/g, '<br/>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  return html;
}

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
  document.getElementById('token-count').textContent = `~${inputTokens} input · ~${historyTokens} session`;
}

const chatInput = document.getElementById('chat-input');
chatInput.addEventListener('input', () => { updateTokenCount(); autoResizeTextarea(chatInput); });
document.getElementById('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

document.getElementById('btn-send').addEventListener('click', sendMessage);

function sanitizePath(filePath) {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\.(\/|$)|^\/+|\/\.\.(\/|$)/g, '');
  const cleaned = normalized.replace(/\/+/g, '/').replace(/^\//, '');
  return cleaned || '_';
}

async function executeToolCall(name, args) {
  const project = currentProject;
  const type = currentProjectType;

  switch (name) {
    case 'read_file':
      if (!project) throw new Error('No project open');
      return await window.electronAPI.projectReadFile(project, sanitizePath(args.path));

    case 'write_file':
      if (!project) throw new Error('No project open');
      await window.electronAPI.projectWriteFile(project, sanitizePath(args.path), args.content);
      return 'File written: ' + sanitizePath(args.path);

    case 'delete_file':
      if (!project) throw new Error('No project open');
      await window.electronAPI.projectDeleteFile(project, sanitizePath(args.path));
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
      const output2 = await window.electronAPI.sandboxExec(execDir, args.command);
      logToTerminal('Command output: ' + output2.substring(0, 500), 'info');
      return output2;

    default:
      if (typeof pluginRegistry !== 'undefined' && pluginRegistry.toolHandlers.has(name)) {
        return await pluginRegistry.executeTool(name, args);
      }
      throw new Error('Unknown tool: ' + name);
  }
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  const provider = document.getElementById('provider-select').value;
  if (!providers[provider]) { logToTerminal('Please configure API key for ' + provider + ' in Settings', 'error'); return; }

  chatHistory.push({ role: 'user', content: text });
  input.value = '';
  renderChat();

  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-msg ai';
  msgDiv.innerHTML = '<div class="msg-label">Florde AI</div>';
  document.getElementById('chat-messages').appendChild(msgDiv);

  const contentDiv = document.createElement('div');
  msgDiv.appendChild(contentDiv);
  let animInterval = null;
  function startAnim(text, suffix = '') {
    if (animInterval) clearInterval(animInterval);
    let dots = 1, dir = 1;
    const update = () => {
      const d = '.'.repeat(dots);
      contentDiv.innerHTML = formatMessageContent(text + d + suffix);
      dots += dir;
      if (dots >= 4) dir = -1;
      if (dots <= 1) dir = 1;
    };
    update();
    animInterval = setInterval(update, 400);
  }
  function stopAnim(final) {
    if (animInterval) { clearInterval(animInterval); animInterval = null; }
    if (final !== undefined) contentDiv.innerHTML = formatMessageContent(final);
  }

  startAnim('*Thinking*');

  logToTerminal('Sending request to ' + provider + '...', 'info');

  try {
    const systemMsg = { role: 'system', content: buildSystemPrompt() };
    let messages = [systemMsg, ...chatHistory.map(m => ({ role: m.role, content: m.content }))];

    let finalContent = '';
    let toolRounds = 0;
    const maxRounds = 15;

    while (toolRounds < maxRounds) {
      const response = await providers[provider].sendWithTools(messages, getActiveTools());
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

    const responseContent = finalContent || (messages.filter(m => m.role === 'assistant' && m.content).pop()?.content) || '';
    if (responseContent) {
      contentDiv.innerHTML = formatMessageContent(responseContent);
      chatHistory.push({ role: 'assistant', content: responseContent, model: provider });
      processAIResponse(responseContent);
    }

    await saveSession();
    if (currentProject) {
      try { await renderFileTree(); } catch {}
    }
    logToTerminal('AI response received', 'success');
  } catch (err) {
    stopAnim();
    const msg = err.message || 'Unknown error';
    let displayMsg = msg;
    if (err.name === 'AbortError') displayMsg = 'Request timed out. Check your network.';
    else if (/40[13]/.test(msg)) displayMsg = msg + ' — Check your API key in settings.';
    else if (/429/.test(msg)) displayMsg = msg + ' — Rate limited. Wait a moment and retry.';
    else if (/Failed to fetch/.test(msg)) displayMsg = 'Network error — check your connection and the API endpoint URL.';
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

  function renderDiff(index) {
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
    else if (currentProject) window.electronAPI.projectReadFile(currentProject, change.file).then(c => { originalContent = c || ''; });

    setTimeout(() => {
      const originalModel = monaco.editor.createModel(originalContent, detectLanguage(change.file), monaco.Uri.parse('file:///diff-old-' + change.file));
      const modifiedModel = monaco.editor.createModel(change.code, detectLanguage(change.file), monaco.Uri.parse('file:///diff-new-' + change.file));
      diffModels = [originalModel, modifiedModel];
      if (diffEditor) diffEditor.dispose();
      diffEditor = monaco.editor.createDiffEditor(diffContainer, {
        enableSplitViewResizing: false, renderSideBySide: true, readOnly: true,
        theme: currentTheme === 'light' ? 'vs' : 'vs-dark',
      });
      diffEditor.setModel({ original: originalModel, modified: modifiedModel });
    }, 100);
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
  document.getElementById('btn-diff-accept').addEventListener('click', acceptAll);

  document.getElementById('btn-diff-reject').addEventListener('click', () => {
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
  document.getElementById('terminal-panel').classList.toggle('hidden');
});

document.getElementById('btn-terminal-clear').addEventListener('click', () => {
  document.getElementById('terminal-output').innerHTML = '';
});

// ==================== THEME TOGGLE ====================

document.getElementById('btn-theme-toggle').addEventListener('click', () => {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme();
  saveSettingsToDisk();
  logToTerminal(`Switched to ${currentTheme} theme`, 'info');
});

// ==================== KEYBOARD SHORTCUTS ====================

document.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key === 's') { e.preventDefault(); saveCurrentFile(); }
  else if (ctrl && e.key === 'n') { e.preventDefault(); document.getElementById('btn-new-file').click(); }
  else if (ctrl && e.key === 'w') { e.preventDefault(); if (activeTabIndex >= 0) closeTab(activeTabIndex); }
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

document.getElementById('btn-save-settings').addEventListener('click', async () => {
  const ok = document.getElementById('key-openai').value;
  const om = document.getElementById('model-openai').value;
  const dk = document.getElementById('key-deepseek').value;
  const dm = document.getElementById('model-deepseek').value;
  const mk = document.getElementById('key-mistral').value;
  const mm = document.getElementById('model-mistral').value;
  const ak = document.getElementById('key-anthropic').value;
  const am = document.getElementById('model-anthropic').value;
  const gk = document.getElementById('key-gemini').value;
  const gm = document.getElementById('model-gemini').value;
  const xk = document.getElementById('key-grok').value;
  const xm = document.getElementById('model-grok').value;
  const ou = document.getElementById('url-ollama').value;
  const olm = document.getElementById('model-ollama').value;

  if (ok) providers.openai = new OpenAIProvider(ok, om);
  if (dk) providers.deepseek = new DeepSeekProvider(dk, dm);
  if (mk) providers.mistral = new MistralProvider(mk, mm);
  if (ak) providers.anthropic = new AnthropicProvider(ak, am);
  if (gk) providers.gemini = new GeminiProvider(gk, gm);
  if (xk) providers.grok = new GrokProvider(xk, xm);
  providers.ollama = new OllamaProvider(ou, olm);

  await saveSettingsToDisk();
  document.getElementById('settings-modal').classList.add('hidden');
  if (document.getElementById('app-view').classList.contains('hidden')) showStartMenu();
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

// ==================== MODAL BACKDROP ====================

document.querySelectorAll('.modal').forEach(m => {
  m.addEventListener('click', (e) => {
    if (e.target === m && !m.id.includes('diff')) {
      m.classList.add('hidden');
      const av = document.getElementById('app-view');
      if (av.classList.contains('hidden')) showStartMenu();
    }
  });
});

// ==================== INIT ====================

loadSettings();
pluginRegistry.init().then(() => {
  window.__updateTools();
});
showStartMenu();

require.config({ paths: { vs: '../node_modules/monaco-editor/min/vs' } });
require(['vs/editor/editor.main'], () => {
  editor = monaco.editor.create(document.getElementById('editor-container'), {
    value: '# Welcome to Florde!\n# Start coding or describe what you want to build in the chat.',
    language: 'python',
    theme: 'vs-dark',
    automaticLayout: true,
    minimap: { enabled: true },
    fontSize: 14,
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    tabSize: 2,
    bracketPairColorization: { enabled: true },
  });

  editor.getModel().onDidChangeContent(() => {
    const name = getActiveFileName();
    if (name) { tabDirty[name] = true; renderTabs(); }
  });
  editor.onDidChangeCursorPosition(() => updateStatusBar());
  updateStatusBar();
});
