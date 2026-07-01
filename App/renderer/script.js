// --- AI Provider Classes ---

class OpenAIProvider {
  constructor(apiKey, model = 'gpt-4o') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async sendMessage(messages, onChunk) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'system', content: 'You are Florde, a coding assistant. Generate working code based on user descriptions. Always include complete, runnable code blocks.' }, ...messages],
        stream: true,
      }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || '';
          fullText += content;
          onChunk(fullText);
        } catch {}
      }
    }
    return fullText;
  }
}

class DeepSeekProvider {
  constructor(apiKey, model = 'deepseek-chat') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async sendMessage(messages, onChunk) {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'system', content: 'You are Florde, a coding assistant. Generate working code based on user descriptions. Always include complete, runnable code blocks.' }, ...messages],
        stream: true,
      }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || '';
          fullText += content;
          onChunk(fullText);
        } catch {}
      }
    }
    return fullText;
  }
}

class MistralProvider {
  constructor(apiKey, model = 'mistral-large-latest') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async sendMessage(messages, onChunk) {
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'system', content: 'You are Florde, a coding assistant. Generate working code based on user descriptions. Always include complete, runnable code blocks.' }, ...messages],
        stream: true,
      }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || '';
          fullText += content;
          onChunk(fullText);
        } catch {}
      }
    }
    return fullText;
  }
}

class OllamaProvider {
  constructor(baseUrl = 'http://localhost:11434', model = 'codellama') {
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async sendMessage(messages, onChunk) {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'system', content: 'You are Florde, a coding assistant. Generate working code based on user descriptions. Always include complete, runnable code blocks.' }, ...messages],
        stream: true,
      }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          const content = parsed.message?.content || '';
          fullText += content;
          onChunk(fullText);
        } catch {}
      }
    }
    return fullText;
  }
}

// --- App ---

const providers = {};

let editor = null;
let chatHistory = [];
let currentFileName = 'untitled.py';
let currentLanguage = 'python';

require.config({ paths: { vs: '../node_modules/monaco-editor/min/vs' } });

require(['vs/editor/editor.main'], function () {
  editor = monaco.editor.create(document.getElementById('editor-container'), {
    value: '# Welcome to Florde\n# Describe what you want to build in the chat panel.\n',
    language: 'python',
    theme: 'vs-dark',
    fontSize: 14,
    minimap: { enabled: false },
    automaticLayout: true,
    padding: { top: 12 },
  });
});

function addMessage(role, content) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `message ${role}`;

  if (role === 'assistant' && content.includes('```')) {
    const parts = content.split('```');
    parts.forEach((part, i) => {
      if (i % 2 === 0) {
        const textDiv = document.createElement('div');
        textDiv.textContent = part;
        div.appendChild(textDiv);
      } else {
        const codeDiv = document.createElement('div');
        codeDiv.className = 'message code';
        codeDiv.textContent = part.replace(/^\w+\n/, '');
        div.appendChild(codeDiv);
      }
    });
  } else {
    div.textContent = content;
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  addMessage('user', text);
  chatHistory.push({ role: 'user', content: text });

  const provider = document.getElementById('provider-select').value;
  const providerInstance = providers[provider];
  if (!providerInstance) {
    addMessage('assistant', 'Please configure the API key in Settings (\u2699).');
    return;
  }

  const messageDiv = document.createElement('div');
  messageDiv.className = 'message assistant';
  document.getElementById('chat-messages').appendChild(messageDiv);

  try {
    const fullText = await providerInstance.sendMessage(chatHistory, (currentText) => {
      messageDiv.innerHTML = '';
      if (currentText.includes('```')) {
        const parts = currentText.split('```');
        parts.forEach((part, i) => {
          if (i % 2 === 0) {
            const textDiv = document.createElement('div');
            textDiv.textContent = part;
            messageDiv.appendChild(textDiv);
          } else {
            const codeDiv = document.createElement('div');
            codeDiv.className = 'message code';
            codeDiv.textContent = part.replace(/^\w+\n/, '');
            messageDiv.appendChild(codeDiv);
          }
        });
      } else {
        messageDiv.textContent = currentText;
      }
      document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
    });
    chatHistory.push({ role: 'assistant', content: fullText });

    // Extract code blocks into the editor
    const codeBlockRegex = /```(\w+)?\n?([\s\S]*?)```/g;
    let match;
    let lastCode = null;
    let lastLang = null;
    while ((match = codeBlockRegex.exec(fullText)) !== null) {
      lastLang = match[1] || null;
      lastCode = match[2].trim();
    }
    if (lastCode && editor) {
      editor.setValue(lastCode);
      if (lastLang) {
        const langMap = { py: 'python', js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript' };
        const normalizedLang = langMap[lastLang] || lastLang;
        const langSelect = document.getElementById('language-select');
        const option = Array.from(langSelect.options).find(o => o.value === normalizedLang);
        if (option) {
          langSelect.value = normalizedLang;
          monaco.editor.setModelLanguage(editor.getModel(), normalizedLang);
        }
      }
    }
  } catch (err) {
    messageDiv.textContent = `Error: ${err.message}`;
  }
}

document.getElementById('btn-send-to-chat').addEventListener('click', () => {
  const code = editor ? editor.getValue() : '';
  if (code.trim()) {
    document.getElementById('chat-input').value = `Here is my current code:\n\`\`\`\n${code}\n\`\`\`\n\nPlease help me modify it: `;
    document.getElementById('chat-input').focus();
  }
});

document.getElementById('btn-send').addEventListener('click', sendMessage);
document.getElementById('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

document.getElementById('language-select').addEventListener('change', (e) => {
  currentLanguage = e.target.value;
  if (editor) {
    monaco.editor.setModelLanguage(editor.getModel(), currentLanguage);
  }
});

document.getElementById('btn-save').addEventListener('click', async () => {
  const content = editor ? editor.getValue() : '';
  const result = await window.electronAPI.saveFile(content, currentFileName);
  if (result) {
    currentFileName = result.split('\\').pop().split('/').pop();
    document.getElementById('file-name').textContent = currentFileName;
  }
});

document.getElementById('btn-open').addEventListener('click', async () => {
  const result = await window.electronAPI.openFile();
  if (result && editor) {
    editor.setValue(result.content);
    currentFileName = result.fileName;
    document.getElementById('file-name').textContent = currentFileName;
  }
});

document.getElementById('btn-settings').addEventListener('click', () => {
  document.getElementById('settings-modal').classList.remove('hidden');
});

document.getElementById('btn-close-settings').addEventListener('click', () => {
  document.getElementById('settings-modal').classList.add('hidden');
});

document.getElementById('btn-save-settings').addEventListener('click', () => {
  const openaiKey = document.getElementById('key-openai').value;
  const openaiModel = document.getElementById('model-openai').value;
  const deepseekKey = document.getElementById('key-deepseek').value;
  const deepseekModel = document.getElementById('model-deepseek').value;
  const mistralKey = document.getElementById('key-mistral').value;
  const mistralModel = document.getElementById('model-mistral').value;
  const ollamaUrl = document.getElementById('url-ollama').value;
  const ollamaModel = document.getElementById('model-ollama').value;

  if (openaiKey) providers.openai = new OpenAIProvider(openaiKey, openaiModel);
  if (deepseekKey) providers.deepseek = new DeepSeekProvider(deepseekKey, deepseekModel);
  if (mistralKey) providers.mistral = new MistralProvider(mistralKey, mistralModel);
  providers.ollama = new OllamaProvider(ollamaUrl, ollamaModel);

  document.getElementById('settings-modal').classList.add('hidden');
});
