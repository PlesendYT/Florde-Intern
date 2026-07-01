// ==================== AI PROVIDERS ====================

class OpenAIProvider {
  constructor(apiKey, model = 'gpt-4o') { this.apiKey = apiKey; this.model = model; }
  async sendMessage(messages, onChunk) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, messages, stream: true }),
    });
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
}

class DeepSeekProvider extends OpenAIProvider {
  constructor(apiKey, model = 'deepseek-chat') { super(apiKey, 'deepseek-chat'); this.apiKey = apiKey; this.model = model; }
  async sendMessage(messages, onChunk) {
    const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, messages, stream: true }),
    });
    return this._stream(r, onChunk);
  }
}

class MistralProvider extends OpenAIProvider {
  constructor(apiKey, model = 'mistral-large-latest') { super(apiKey, model); this.apiKey = apiKey; this.model = model; }
  async sendMessage(messages, onChunk) {
    const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, messages, stream: true }),
    });
    return this._stream(r, onChunk);
  }
}

class OllamaProvider {
  constructor(baseUrl = 'http://localhost:11434', model = 'codellama') { this.baseUrl = baseUrl; this.model = model; }
  async sendMessage(messages, onChunk) {
    const r = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages, stream: true }),
    });
    const reader = r.body.getReader(), decoder = new TextDecoder();
    let full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value).split('\n').filter(l => l.trim());
      for (const line of lines) { try { const p = JSON.parse(line); const c = p.message?.content || ''; full += c; onChunk(full); } catch {} }
    }
    return full;
  }
}

// ==================== STATE ====================

const providers = {};
let editor = null;
let chatHistory = [];
let currentProject = null;
let openTabs = [];
let activeTabIndex = -1;
let tabContents = {};
let tabLanguages = {};
let tabDirty = {};
let lastAssistantText = '';
let autoSaveTimer = null;

const SYSTEM_PROMPT_BASE = `You are Florde, an AI coding assistant inside the Florde desktop app.

You help users build software by writing, modifying, and explaining code.

## Project Files
{fileList}

## File Operations
When you write code, use code blocks with filenames like:
\`\`\`file:path/to/file.py
[code content]
\`\`\`

This creates or updates files in the project. The editor will show the modified file.

To delete a file write: [DELETE FILE: path/to/file.py]

To explain things, just write normally. The user sees everything you say in the chat.`;

// ==================== SETTINGS ====================

async function loadSettings() {
  const s = await window.electronAPI.getSettings();
  if (!s) return;
  if (s.openaiKey) { document.getElementById('key-openai').value = s.openaiKey; providers.openai = new OpenAIProvider(s.openaiKey, s.openaiModel || 'gpt-4o'); }
  if (s.deepseekKey) { document.getElementById('key-deepseek').value = s.deepseekKey; providers.deepseek = new DeepSeekProvider(s.deepseekKey, s.deepseekModel || 'deepseek-chat'); }
  if (s.mistralKey) { document.getElementById('key-mistral').value = s.mistralKey; providers.mistral = new MistralProvider(s.mistralKey, s.mistralModel || 'mistral-large-latest'); }
  if (s.ollamaUrl) document.getElementById('url-ollama').value = s.ollamaUrl;
  if (s.ollamaModel) document.getElementById('model-ollama').value = s.ollamaModel;
  providers.ollama = new OllamaProvider(s.ollamaUrl || 'http://localhost:11434', s.ollamaModel || 'codellama');
  if (s.openaiModel) document.getElementById('model-openai').value = s.openaiModel;
  if (s.deepseekModel) document.getElementById('model-deepseek').value = s.deepseekModel;
  if (s.mistralModel) document.getElementById('model-mistral').value = s.mistralModel;
}

async function saveSettingsToDisk() {
  await window.electronAPI.saveSettings({
    openaiKey: document.getElementById('key-openai').value,
    openaiModel: document.getElementById('model-openai').value,
    deepseekKey: document.getElementById('key-deepseek').value,
    deepseekModel: document.getElementById('model-deepseek').value,
    mistralKey: document.getElementById('key-mistral').value,
    mistralModel: document.getElementById('model-mistral').value,
    ollamaUrl: document.getElementById('url-ollama').value,
    ollamaModel: document.getElementById('model-ollama').value,
  });
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
  if (projects.length === 0) { container.innerHTML = '<div style="color:#666;font-size:0.85rem;padding:0.5rem;">No projects yet</div>'; return; }
  for (const p of projects) {
    const div = document.createElement('div');
    div.className = 'project-item';
    div.innerHTML = `<span>${p.name}</span><button class="project-del" data-name="${p.name}">&times;</button>`;
    div.querySelector('span').addEventListener('click', () => openProject(p.name));
    div.querySelector('.project-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Delete project "${p.name}"?`)) {
        await window.electronAPI.deleteProject(p.name);
        loadProjectList();
      }
    });
    container.appendChild(div);
  }
  document.getElementById('project-list').classList.remove('hidden');
}

document.getElementById('btn-start-new').addEventListener('click', () => {
  document.getElementById('new-project-modal').classList.remove('hidden');
  document.getElementById('new-project-name').value = '';
  document.getElementById('new-project-name').focus();
});

document.getElementById('btn-cancel-new').addEventListener('click', () => {
  document.getElementById('new-project-modal').classList.add('hidden');
});

document.getElementById('btn-create-project').addEventListener('click', async () => {
  const name = document.getElementById('new-project-name').value.trim();
  if (!name) return;
  const ok = await window.electronAPI.createProject(name);
  if (ok) {
    document.getElementById('new-project-modal').classList.add('hidden');
    await openProject(name);
  } else {
    alert('Project already exists');
  }
});

document.getElementById('btn-start-open').addEventListener('click', loadProjectList);

document.getElementById('btn-start-settings').addEventListener('click', () => {
  document.getElementById('settings-modal').classList.remove('hidden');
  document.getElementById('start-menu').classList.add('hidden');
});

document.getElementById('btn-back-menu').addEventListener('click', async () => {
  await saveSession();
  showStartMenu();
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

  if (files.length > 0) {
    for (const f of files) await openTab(f, false);
    if (openTabs.length > 0) switchTab(0);
  } else {
    newUntitledTab();
  }

  renderTabs();
  renderChat();
  showAppView();
}

async function saveSession() {
  if (!currentProject) return;
  // Save all dirty files first
  for (const tab of openTabs) {
    if (tabDirty[tab]) {
      await window.electronAPI.projectWriteFile(currentProject, tab, tabContents[tab]);
    }
  }
  await window.electronAPI.saveSession(currentProject, { history: chatHistory });
}

// ==================== TABS (MULTI-EDIT) ====================

function getLangFromFilename(name) {
  const ext = name.split('.').pop();
  const map = { py: 'python', js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript', html: 'html', css: 'css', json: 'json', md: 'markdown', txt: 'plaintext', cpp: 'cpp', c: 'c', h: 'c', java: 'java', go: 'go', rs: 'rust', rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin', yml: 'yaml', yaml: 'yaml', xml: 'xml', sql: 'sql', sh: 'shell', bat: 'bat' };
  return map[ext] || 'plaintext';
}

async function openTab(filePath, switchTo = true) {
  if (openTabs.includes(filePath)) {
    if (switchTo) switchTab(openTabs.indexOf(filePath));
    return;
  }
  openTabs.push(filePath);
  const content = await window.electronAPI.projectReadFile(currentProject, filePath);
  tabContents[filePath] = content || '';
  tabLanguages[filePath] = getLangFromFilename(filePath);
  tabDirty[filePath] = false;
  if (switchTo) switchTab(openTabs.length - 1);
  renderTabs();
}

function closeTab(index) {
  const filePath = openTabs[index];
  if (tabDirty[filePath]) {
    if (!confirm(`Save changes to ${filePath}?`)) return;
    saveCurrentTab();
  }
  openTabs.splice(index, 1);
  delete tabContents[filePath];
  delete tabLanguages[filePath];
  delete tabDirty[filePath];
  if (openTabs.length === 0) newUntitledTab();
  if (activeTabIndex >= openTabs.length) activeTabIndex = openTabs.length - 1;
  if (activeTabIndex >= 0) switchTab(activeTabIndex);
  renderTabs();
}

function newUntitledTab() {
  const name = 'untitled.py';
  if (!openTabs.includes(name)) {
    openTabs.push(name);
    tabContents[name] = '';
    tabLanguages[name] = 'python';
    tabDirty[name] = false;
  }
  switchTab(openTabs.indexOf(name));
  renderTabs();
}

function switchTab(index) {
  if (index < 0 || index >= openTabs.length) return;
  if (activeTabIndex >= 0 && activeTabIndex < openTabs.length) {
    const oldFile = openTabs[activeTabIndex];
    if (editor && tabDirty[oldFile]) {
      tabContents[oldFile] = editor.getValue();
    }
  }
  activeTabIndex = index;
  const filePath = openTabs[index];
  document.getElementById('file-name').textContent = filePath;
  const lang = tabLanguages[filePath];
  document.getElementById('language-select').value = lang;
  if (editor) {
    editor.setValue(tabContents[filePath] || '');
    monaco.editor.setModelLanguage(editor.getModel(), lang);
    editor.focus();
  }
  renderTabs();
}

function saveCurrentTab() {
  if (activeTabIndex < 0 || !currentProject) return;
  const filePath = openTabs[activeTabIndex];
  if (editor) tabContents[filePath] = editor.getValue();
  tabDirty[filePath] = false;
  window.electronAPI.projectWriteFile(currentProject, filePath, tabContents[filePath]);
  renderTabs();
}

async function saveAllTabs() {
  for (const tab of openTabs) {
    if (activeTabIndex >= 0 && tab === openTabs[activeTabIndex] && editor) {
      tabContents[tab] = editor.getValue();
    }
    if (tabDirty[tab]) {
      await window.electronAPI.projectWriteFile(currentProject, tab, tabContents[tab]);
      tabDirty[tab] = false;
    }
  }
  renderTabs();
}

function renderTabs() {
  const container = document.getElementById('file-tabs');
  container.innerHTML = '';
  for (let i = 0; i < openTabs.length; i++) {
    const f = openTabs[i];
    const div = document.createElement('div');
    div.className = 'file-tab' + (i === activeTabIndex ? ' active' : '');
    const name = f.split('/').pop();
    div.innerHTML = `${tabDirty[f] ? '<span class="tab-dot">&#x25CF;</span>' : ''}${name}<button class="tab-close">&times;</button>`;
    div.addEventListener('click', (e) => { if (e.target.tagName !== 'BUTTON') switchTab(i); });
    div.querySelector('.tab-close').addEventListener('click', (e) => { e.stopPropagation(); closeTab(i); });
    container.appendChild(div);
  }
}

// Editor change tracking
function onEditorContentChange() {
  if (activeTabIndex < 0) return;
  const filePath = openTabs[activeTabIndex];
  if (editor && editor.getValue() !== tabContents[filePath]) {
    tabDirty[filePath] = true;
    renderTabs();
    scheduleAutoSave();
  }
}

function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(saveAllTabs, 10000);
}

// ==================== MONACO ====================

require.config({ paths: { vs: '../node_modules/monaco-editor/min/vs' } });
require(['vs/editor/editor.main'], function () {
  editor = monaco.editor.create(document.getElementById('editor-container'), {
    value: '# Welcome to Florde\n# Create or open a project to start building.\n',
    language: 'python',
    theme: 'vs-dark',
    fontSize: 14,
    minimap: { enabled: false },
    automaticLayout: true,
    padding: { top: 12 },
  });
  editor.onDidChangeModelContent(onEditorContentChange);
});

// ==================== CHAT ====================

function renderChat() {
  const container = document.getElementById('chat-messages');
  container.innerHTML = '';
  for (const msg of chatHistory) {
    addMessageToDOM(msg.role, msg.content);
  }
}

function addMessageToDOM(role, content) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `message ${role}`;
  if (role === 'assistant' && content.includes('```')) {
    const parts = content.split('```');
    parts.forEach((part, i) => {
      if (i % 2 === 0) {
        const td = document.createElement('div'); td.textContent = part; div.appendChild(td);
      } else {
        const cd = document.createElement('div'); cd.className = 'message code';
        cd.textContent = part.replace(/^\w+\n/, '');
        const isFileBlock = part.startsWith('file:');
        if (isFileBlock) {
          cd.style.borderLeft = '3px solid #7c3aed';
          cd.style.cursor = 'pointer';
          cd.title = 'Click to apply this file';
          const filePath = part.split('\n')[0].slice(5).trim();
          const codeContent = part.split('\n').slice(1).join('\n').trim();
          cd.addEventListener('click', async () => {
            if (currentProject) {
              await window.electronAPI.projectWriteFile(currentProject, filePath, codeContent);
              if (openTabs.includes(filePath)) {
                tabContents[filePath] = codeContent;
                tabDirty[filePath] = false;
              } else {
                await openTab(filePath);
                tabContents[filePath] = codeContent;
              }
              if (activeTabIndex >= 0 && openTabs[activeTabIndex] === filePath && editor) {
                editor.setValue(codeContent);
                monaco.editor.setModelLanguage(editor.getModel(), getLangFromFilename(filePath));
              }
              renderTabs();
            }
          });
        }
        div.appendChild(cd);
      }
    });
  } else {
    div.textContent = content;
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function buildSystemPrompt() {
  let fileList = '(empty project)';
  if (currentProject) {
    // We'll inject file list dynamically
  }
  return SYSTEM_PROMPT_BASE.replace('{fileList}', '(see project files below)');
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  addMessageToDOM('user', text);
  chatHistory.push({ role: 'user', content: text });

  const provider = document.getElementById('provider-select').value;
  const providerInstance = providers[provider];
  if (!providerInstance) {
    addMessageToDOM('assistant', 'Please configure the API key in Settings.');
    return;
  }

  // Build system message with project context
  let fileContext = 'This project has no files yet.';
  if (currentProject) {
    const files = await window.electronAPI.projectListFiles(currentProject);
    if (files.length > 0) {
      fileContext = 'Project files:\n' + files.map(f => {
        const content = tabContents[f] !== undefined ? tabContents[f] : '(loaded)';
        return `- ${f}`;
      }).join('\n');
    }
  }

  const systemMsg = `You are Florde, an AI coding assistant inside the Florde desktop app.

You help users build software by writing, modifying, and explaining code.

${fileContext}

## How to respond
- Use \`\`\`file:path/to/file.py\n[code]\n\`\`\` to create or update files
- Use [DELETE FILE: path/to/file.py] to delete a file
- Use \`\`\` (without file:) for code examples that should NOT be saved to the project
- Regular text is displayed as explanation in chat

Always include complete, working code.`;

  const messageDiv = document.createElement('div');
  messageDiv.className = 'message assistant';
  document.getElementById('chat-messages').appendChild(messageDiv);

  try {
    const msgs = [{ role: 'system', content: systemMsg }, ...chatHistory];
    lastAssistantText = '';
    const fullText = await providerInstance.sendMessage(msgs, (currentText) => {
      lastAssistantText = currentText;
      messageDiv.innerHTML = '';
      if (currentText.includes('```')) {
        const parts = currentText.split('```');
        parts.forEach((part, i) => {
          if (i % 2 === 0) {
            const td = document.createElement('div'); td.textContent = part; messageDiv.appendChild(td);
          } else {
            const cd = document.createElement('div'); cd.className = 'message code';
            cd.textContent = part.replace(/^\w+\n/, '');
            const isFileBlock = part.startsWith('file:');
            if (isFileBlock) {
              cd.style.borderLeft = '3px solid #7c3aed';
              cd.style.cursor = 'pointer';
              cd.title = 'Click to apply this file';
              const filePath = part.split('\n')[0].slice(5).trim();
              const codeContent = part.split('\n').slice(1).join('\n').trim();
              cd.addEventListener('click', async () => await applyFileBlock(filePath, codeContent));
            }
            messageDiv.appendChild(cd);
          }
        });
      } else {
        messageDiv.textContent = currentText;
      }
      document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
    });
    chatHistory.push({ role: 'assistant', content: fullText });

    // Auto-apply file blocks and delete operations
    await processAIActions(fullText);

    // Auto-save session
    if (currentProject) {
      await saveAllTabs();
      await window.electronAPI.saveSession(currentProject, { history: chatHistory });
    }
  } catch (err) {
    messageDiv.textContent = `Error: ${err.message}`;
  }
}

async function applyFileBlock(filePath, codeContent) {
  if (!currentProject) { alert('Open a project first'); return; }
  await window.electronAPI.projectWriteFile(currentProject, filePath, codeContent);
  if (openTabs.includes(filePath)) {
    tabContents[filePath] = codeContent;
    tabDirty[filePath] = false;
  } else {
    await openTab(filePath);
    tabContents[filePath] = codeContent;
  }
  if (activeTabIndex >= 0 && openTabs[activeTabIndex] === filePath && editor) {
    editor.setValue(codeContent);
    monaco.editor.setModelLanguage(editor.getModel(), getLangFromFilename(filePath));
  }
  document.getElementById('language-select').value = getLangFromFilename(filePath);
  renderTabs();
}

async function processAIActions(text) {
  // Apply file: blocks
  const fileRegex = /```file:(\S+)\n?([\s\S]*?)```/g;
  let match;
  while ((match = fileRegex.exec(text)) !== null) {
    const filePath = match[1].trim();
    const codeContent = match[2].trim();
    await applyFileBlock(filePath, codeContent);
  }

  // Handle delete operations
  const delRegex = /\[DELETE FILE:\s*(\S+?)\]/g;
  while ((match = delRegex.exec(text)) !== null) {
    const filePath = match[1].trim();
    if (currentProject) {
      await window.electronAPI.projectDeleteFile(currentProject, filePath);
      const idx = openTabs.indexOf(filePath);
      if (idx >= 0) {
        openTabs.splice(idx, 1);
        delete tabContents[filePath];
        delete tabLanguages[filePath];
        delete tabDirty[filePath];
        if (openTabs.length === 0) newUntitledTab();
        if (activeTabIndex >= openTabs.length) activeTabIndex = openTabs.length - 1;
        if (activeTabIndex >= 0) switchTab(activeTabIndex);
        renderTabs();
      }
    }
  }

  // Extract last code block into current editor
  const codeRegex = /```(\w+)?\n?([\s\S]*?)```/g;
  let lastCode = null, lastLang = null;
  while ((match = codeRegex.exec(text)) !== null) {
    if (!match[0].startsWith('```file:')) {
      lastLang = match[1] || null;
      lastCode = match[2].trim();
    }
  }
  if (lastCode && editor && !currentProject) {
    editor.setValue(lastCode);
    if (lastLang) {
      const langMap = { py: 'python', js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript' };
      const nl = langMap[lastLang] || lastLang;
      const sel = document.getElementById('language-select');
      const opt = Array.from(sel.options).find(o => o.value === nl);
      if (opt) { sel.value = nl; monaco.editor.setModelLanguage(editor.getModel(), nl); }
    }
  }
}

// ==================== EVENT LISTENERS ====================

document.getElementById('btn-send').addEventListener('click', sendMessage);
document.getElementById('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

document.getElementById('btn-send-to-chat').addEventListener('click', () => {
  if (!editor) return;
  const code = editor.getValue();
  if (code.trim()) {
    const fileName = activeTabIndex >= 0 ? openTabs[activeTabIndex] : 'untitled.py';
    document.getElementById('chat-input').value = `Here is my ${fileName}:\n\`\`\`\n${code}\n\`\`\`\n\nPlease help me modify it: `;
    document.getElementById('chat-input').focus();
  }
});

document.getElementById('language-select').addEventListener('change', (e) => {
  if (activeTabIndex < 0 || !editor) return;
  const lang = e.target.value;
  tabLanguages[openTabs[activeTabIndex]] = lang;
  monaco.editor.setModelLanguage(editor.getModel(), lang);
});

document.getElementById('btn-save-all').addEventListener('click', saveAllTabs);

document.getElementById('btn-settings').addEventListener('click', () => {
  document.getElementById('settings-modal').classList.remove('hidden');
});

document.getElementById('btn-close-settings').addEventListener('click', () => {
  document.getElementById('settings-modal').classList.add('hidden');
  if (document.getElementById('app-view').classList.contains('hidden')) {
    showStartMenu();
  }
});

document.getElementById('btn-save-settings').addEventListener('click', async () => {
  const ok = document.getElementById('key-openai').value;
  const om = document.getElementById('model-openai').value;
  const dk = document.getElementById('key-deepseek').value;
  const dm = document.getElementById('model-deepseek').value;
  const mk = document.getElementById('key-mistral').value;
  const mm = document.getElementById('model-mistral').value;
  const ou = document.getElementById('url-ollama').value;
  const olm = document.getElementById('model-ollama').value;

  if (ok) providers.openai = new OpenAIProvider(ok, om);
  if (dk) providers.deepseek = new DeepSeekProvider(dk, dm);
  if (mk) providers.mistral = new MistralProvider(mk, mm);
  providers.ollama = new OllamaProvider(ou, olm);

  await saveSettingsToDisk();
  document.getElementById('settings-modal').classList.add('hidden');
  if (document.getElementById('app-view').classList.contains('hidden')) {
    showStartMenu();
  }
});

// ==================== INIT ====================

loadSettings();
showStartMenu();
