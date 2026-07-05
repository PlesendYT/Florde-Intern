// ==================== PLUGIN SYSTEM ====================

class PluginRegistry {
  constructor() {
    this.plugins = new Map();
    this.toolHandlers = new Map();
    this.promptExtensions = [];
    this._loaded = false;
  }

  async init() {
    const stored = await window.electronAPI.getPlugins().catch(() => []);
    for (const p of stored) {
      if (this.plugins.has(p.id)) {
        const existing = this.plugins.get(p.id);
        this.plugins.set(p.id, { ...existing, enabled: p.enabled === true, installed: p.installed === true });
      } else {
        this.plugins.set(p.id, p);
      }
    }
    this._loaded = true;
  }

  registerBuiltin(manifest) {
    const id = manifest.id;
    if (!this.plugins.has(id)) {
      this.plugins.set(id, { ...manifest, builtin: true, enabled: true, installed: true });
    } else {
      const existing = this.plugins.get(id);
      this.plugins.set(id, { ...manifest, builtin: true, enabled: existing.enabled, installed: true });
    }
    this.save();
  }

  async installFromUrl(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch plugin manifest: ${resp.status}`);
    const manifest = await resp.json();
    if (!manifest.id || !manifest.name) throw new Error('Invalid plugin manifest: missing id or name');
    if (this.plugins.has(manifest.id) && this.plugins.get(manifest.id).installed) {
      throw new Error(`Plugin "${manifest.name}" is already installed`);
    }
    this.plugins.set(manifest.id, { ...manifest, builtin: false, enabled: true, installed: true });
    this.save();
    return manifest;
  }

  uninstall(id) {
    const p = this.plugins.get(id);
    if (!p) throw new Error('Plugin not found');
    if (p.builtin) {
      this.plugins.set(id, { ...p, enabled: false });
    } else {
      this.plugins.delete(id);
    }
    this.save();
  }

  setEnabled(id, enabled) {
    const p = this.plugins.get(id);
    if (!p) throw new Error('Plugin not found');
    this.plugins.set(id, { ...p, enabled });
    this.save();
  }

  registerTool(name, handler) {
    this.toolHandlers.set(name, handler);
  }

  getActiveTools() {
    const tools = [];
    for (const p of this.plugins.values()) {
      if (p.enabled !== true || !p.tools) continue;
      for (const t of p.tools) {
        const existing = tools.findIndex(x => x.function.name === t.function.name);
        if (existing >= 0) tools[existing] = t;
        else tools.push(t);
      }
    }
    return tools;
  }

  getActivePromptExtensions() {
    const exts = [];
    for (const p of this.plugins.values()) {
      if (p.enabled === true && p.promptExtension) exts.push(p.promptExtension);
    }
    return exts;
  }

  async executeTool(name, args) {
    const handler = this.toolHandlers.get(name);
    if (!handler) throw new Error(`No handler registered for tool: ${name}`);
    return handler(args);
  }

  list() {
    return Array.from(this.plugins.values());
  }

  get(id) {
    return this.plugins.get(id);
  }

  registerLocal(manifest) {
    const id = manifest.id || 'local-' + Date.now();
    this.plugins.set(id, { ...manifest, id, builtin: false, enabled: true, installed: true, local: true });
    this.save();
  }

  async save() {
    const data = Array.from(this.plugins.values()).map(p => ({
      id: p.id, enabled: p.enabled, installed: p.installed,
      builtin: p.builtin, name: p.name, version: p.version,
    }));
    await window.electronAPI.savePlugins(data).catch(() => {});
  }
}

const pluginRegistry = new PluginRegistry();

// ==================== BUILT-IN PLUGINS ====================

pluginRegistry.registerBuiltin({
  id: 'superpowers',
  name: 'SuperPowers',
  version: '1.0.0',
  description: 'Web search and web fetch capabilities. Enables the AI to search the web and fetch URL content.',
  author: 'Prime Radiant',
  repo: 'https://github.com/obra/superpowers',
  icon: '⚡',
  tools: [
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the web for current information. Use this when you need up-to-date data, documentation, news, or answers to questions about recent events.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query' },
            numResults: { type: 'number', description: 'Number of results (default 5)', default: 5 }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'web_fetch',
        description: 'Fetch and read the content of a web page or API endpoint. Returns markdown-formatted text.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The URL to fetch' },
            format: { type: 'string', enum: ['markdown', 'text', 'html'], description: 'Response format', default: 'markdown' }
          },
          required: ['url']
        }
      }
    }
  ]
});

pluginRegistry.registerTool('web_search', async (args) => {
  try {
    const result = await window.electronAPI.webSearch(args.query, args.numResults || 5);
    return typeof result === 'string' ? result : JSON.stringify(result);
  } catch (err) {
    try {
      const r = await fetch('https://api.duckduckgo.com/?q=' + encodeURIComponent(args.query) + '&format=json');
      const data = await r.json();
      return JSON.stringify({ results: data.RelatedTopics?.slice(0, args.numResults || 5).map(t => ({ title: t.Text, url: t.FirstURL })) || [] });
    } catch (e2) {
      return 'Web search is not available in this environment. Install the Florde SuperPowers backend or use a different approach.';
    }
  }
});

pluginRegistry.registerTool('web_fetch', async (args) => {
  try {
    const r = await fetchWithTimeout(args.url, {}, 30000);
    const text = await r.text();
    if (args.format === 'html') return text;
    const match = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const body = match ? match[1] : text;
    const cleaned = body
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[^;]+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const truncated = cleaned.length > 50000 ? cleaned.slice(0, 50000) + '... [truncated]' : cleaned;
    return truncated;
  } catch (err) {
    return 'Error fetching URL: ' + err.message;
  }
});

pluginRegistry.registerBuiltin({
  id: 'more-develop-utilitys',
  name: 'More Develop Utilitys',
  version: '1.0.0',
  description: 'Additional development utilities for coding, debugging, and project management.',
  author: 'Florde',
  icon: '🔧',
  tools: []
});

// ==================== PLUGIN UI HELPERS ====================

function renderPluginCard(plugin) {
  const div = document.createElement('div');
  div.className = 'plugin-card' + (plugin.enabled === false ? ' plugin-disabled' : '');
  const isBuiltin = plugin.builtin;
  div.innerHTML = `
    <div class="plugin-card-icon" style="background:${isBuiltin ? 'rgba(99,102,241,0.15)' : 'rgba(34,197,94,0.15)'}">
      ${plugin.icon || '⚡'}
    </div>
    <div class="plugin-info">
      <div class="plugin-name">${plugin.name} <span style="font-size:0.7rem;color:var(--text3);font-weight:400;">v${plugin.version || '1.0'}</span></div>
      <div class="plugin-desc">${plugin.description || ''}</div>
      <div class="plugin-author">${plugin.author || 'Unknown'}${isBuiltin ? ' · Built-in' : ''}${plugin.repo ? ' · <a href="'+plugin.repo+'" target="_blank" style="color:var(--accent);">Repo ↗</a>' : ''}</div>
    </div>
    ${plugin.installed !== false
      ? `<span class="plugin-status ${plugin.enabled !== false ? 'enabled' : 'installed'}">${plugin.enabled !== false ? 'Enabled' : 'Disabled'}</span>
         <button class="plugin-toggle" data-action="toggle" data-id="${plugin.id}">${plugin.enabled !== false ? 'Disable' : 'Enable'}</button>`
      : `<button class="plugin-toggle" data-action="install" data-id="${plugin.id}">Install</button>`
    }
  `;
  return div;
}

function renderPluginMarketplace() {
  const container = document.getElementById('marketplace-list');
  if (!container) return;
  container.innerHTML = '';

  const allPlugins = pluginRegistry.list();

  if (allPlugins.length === 0) {
    container.innerHTML = '<div style="color:var(--text3);padding:2rem;text-align:center;">No plugins available</div>';
    return;
  }

  for (const p of allPlugins) {
    container.appendChild(renderPluginCard(p));
  }

  const availableContainer = document.getElementById('available-plugins');
  if (availableContainer) {
    availableContainer.innerHTML = '';
    const futureMarker = document.createElement('div');
    futureMarker.style.cssText = 'color:var(--text3);padding:1rem;text-align:center;font-size:0.85rem;';
    futureMarker.textContent = 'More plugins coming soon. Community developers can create plugins using the Florde Plugin API.';
    availableContainer.appendChild(futureMarker);
  }
}

function setupPluginEventHandlers() {
  document.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('.plugin-toggle[data-action="toggle"]');
    if (toggleBtn) {
      const id = toggleBtn.dataset.id;
      const plugin = pluginRegistry.get(id);
      if (plugin) {
        const newState = !plugin.enabled;
        pluginRegistry.setEnabled(id, newState);
        renderPluginMarketplace();
        updateAITools();
        logToTerminal(`Plugin "${id}" ${newState ? 'enabled' : 'disabled'}`, 'info');
      }
      return;
    }

    const installBtn = e.target.closest('.plugin-toggle[data-action="install"]');
    if (installBtn) {
      const id = installBtn.dataset.id;
      const plugin = pluginRegistry.get(id);
      if (plugin) {
        pluginRegistry.setEnabled(id, true);
        plugin.installed = true;
        pluginRegistry.save();
        renderPluginMarketplace();
        updateAITools();
        logToTerminal(`Plugin "${id}" installed`, 'success');
      }
    }
  });
}

function updateAITools() {
  if (typeof window.__updateTools === 'function') {
    window.__updateTools();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupPluginEventHandlers();
});

// ==================== PLUGIN DOCS ====================

const PluginDocs = {
  _content: {
    'getting-started': '# Getting Started\n\n## Prerequisites\n- Basic knowledge of JavaScript\n- Florde installed (v1.0+)\n\n## Your First Plugin\nCreate a folder with a `manifest.json` and an `index.js`. Pack it into a **ZIP file** and upload it via the Plugin Marketplace.\n\n## Loading a Plugin\n1. Open Florde → Plugins → Marketplace\n2. Click the **+ Upload** button\n3. Select a **.zip file** (or a folder in Chromium-based browsers)\n4. The plugin appears under Installed Plugins\n\n## Download Example\nUse the Examples section to download a complete **hello-world-plugin.zip** and install it directly.',
    'manifest': '# Plugin Manifest (manifest.json)\n\n```json\n{\n  "name": "my-plugin",\n  "version": "1.0.0",\n  "description": "My first plugin",\n  "author": "You",\n  "main": "index.js",\n  "hooks": ["onMessage", "onFileOpen"],\n  "tools": [],\n  "category": "tools",\n  "icon": "icon.png"\n}\n```\n\n- **name**: Unique plugin name\n- **version**: Semantic version\n- **main**: Entry script (loaded via script tag)\n- **hooks**: Lifecycle hooks to listen to\n- **tools**: Tool definitions the AI can call\n- **category**: Used for marketplace filtering\n\nPacke dein Plugin-Verzeichnis in eine **ZIP-Datei** (manifest.json + index.js + assets) und installiere es uber **+ Upload**.',
    'api-hooks': '# API Hooks\n\n## onMessage(role, content)\nCalled when a message is added to the chat.\n- **role**: `"user"` or `"assistant"`\n- **content**: The message text\n\n## onFileOpen(path, content)\nCalled when a file is opened in the editor.\n- **path**: File path relative to project\n- **content**: File content as string\n\n## onFileSave(path, content)\nCalled when a file is saved.\n\n## onAppReady()\nCalled when the application finishes initializing.\n\n> **Distribute your plugin as a ZIP file** containing `manifest.json`, your scripts, and any assets. Users upload it via **+ Upload** in the Plugin Marketplace.',
    'tools': '# Registering Tools\n\nPlugins can register custom tools that the AI can call during conversations:\n\n```javascript\npluginRegistry.registerTool("my_tool", async (args) => {\n  return "Result: " + args.input;\n});\n```\n\nTools appear in the AI\'s tool list. Pack your plugin folder into a **ZIP file** and upload it via **+ Upload**.',
    'themes': '# Custom Themes\n\nProvide a CSS file in your plugin that defines CSS custom properties:\n\n```css\n[data-theme="my-theme"] {\n  --bg: #ffffff;\n  --text: #000000;\n  --accent: #7c3aed;\n}\n```\n\nUsers can select your theme from Appearance settings.',
    'examples': '# Example Plugins\n\n## Hello World Plugin\n\nA minimal plugin that registers a `hello_world` tool and hooks into app events.\n\n<button class="btn btn-sm btn-primary" onclick="downloadExamplePlugin()" style="margin:0.5rem 0;">\u2B07 hello-world-plugin.zip herunterladen</button>\n\nLade die ZIP herunter und installiere sie uber **+ Upload** im Plugin Marketplace.\n\n### manifest.json:\n```json\n{\n  "name": "hello-world",\n  "version": "1.0.0",\n  "description": "Hello World example plugin",\n  "author": "Florde",\n  "main": "index.js",\n  "hooks": ["onMessage", "onAppReady"],\n  "tools": [{\n    "type": "function",\n    "function": {\n      "name": "hello_world",\n      "description": "Returns a friendly greeting",\n      "parameters": {\n        "type": "object",\n        "properties": {\n          "name": { "type": "string", "description": "Name to greet" }\n        },\n        "required": ["name"]\n      }\n    }\n  }]\n}\n```\n\n### index.js:\n```javascript\nconsole.log(\"Hello World plugin loaded!\");\n\nwindow.addEventListener(\"app-ready\", () => {\n  console.log(\"Florde is ready!\");\n});\n\npluginRegistry.registerTool(\"hello_world\", async (args) => {\n  return \"Hello, \" + (args.name || \"World\") + \"! Greetings from Florde.\";\n});\n```'
  },

  show() {
    const modal = document.getElementById('plugin-docs-modal');
    if (modal) modal.classList.remove('hidden');
    this.showDoc('getting-started');
  },

  showDoc(id) {
    const content = document.getElementById('plugin-docs-content');
    if (!content) return;
    const md = this._content[id] || '# Not found';
    content.innerHTML = renderMarkdown(md);
    document.querySelectorAll('.docs-sidebar a').forEach(a => a.classList.toggle('active', a.dataset.doc === id));
  }
};

// ==================== ZIP UTILITIES ====================

function crc32(data) {
  let crc = 0xFFFFFFFF;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  })());
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createZip(files) {
  const encoder = new TextEncoder();
  const parts = [];
  const centralEntries = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const data = encoder.encode(content);
    const crc = crc32(data);
    const compSize = data.byteLength;
    const nameBytes = encoder.encode(name);

    const lh = new ArrayBuffer(30 + nameBytes.length);
    const lv = new DataView(lh);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, compSize, true);
    lv.setUint32(22, compSize, true);
    lv.setUint16(26, nameBytes.length, true);
    new Uint8Array(lh, 30).set(nameBytes);

    parts.push(lh, data.buffer);

    const ch = new ArrayBuffer(46 + nameBytes.length);
    const cv = new DataView(ch);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, compSize, true);
    cv.setUint32(24, compSize, true);
    cv.setUint16(28, nameBytes.length, true);
    new Uint8Array(ch, 46).set(nameBytes);
    cv.setUint32(42, offset, true);

    centralEntries.push(ch);
    offset += lh.byteLength + compSize;
  }

  const centralSize = centralEntries.reduce((s, b) => s + b.byteLength, 0);
  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centralEntries.length, true);
  ev.setUint16(10, centralEntries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  parts.push(...centralEntries, eocd);

  const total = parts.reduce((s, b) => s + b.byteLength, 0);
  const result = new Uint8Array(total);
  let pos = 0;
  for (const b of parts) { result.set(new Uint8Array(b), pos); pos += b.byteLength; }
  return new Blob([result], { type: 'application/zip' });
}

function extractZip(buffer) {
  const dv = new DataView(buffer);
  const decoder = new TextDecoder();
  // Find EOCD
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Invalid ZIP: no EOCD signature');

  const centralOffset = dv.getUint32(eocd + 16, true);
  const numEntries = dv.getUint16(eocd + 10, true);
  const files = {};

  let pos = centralOffset;
  for (let i = 0; i < numEntries; i++) {
    if (dv.getUint32(pos, true) !== 0x02014b50) break;
    const nameLen = dv.getUint16(pos + 28, true);
    const extraLen = dv.getUint16(pos + 30, true);
    const localOffset = dv.getUint32(pos + 42, true);
    const compSize = dv.getUint32(pos + 20, true);
    const name = decoder.decode(new Uint8Array(buffer, pos + 46, nameLen));
    pos += 46 + nameLen + extraLen + dv.getUint16(pos + 32, true);

    if (name.endsWith('/')) continue;

    const lhNameLen = dv.getUint16(localOffset + 26, true);
    const lhExtraLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lhNameLen + lhExtraLen;
    files[name] = decoder.decode(new Uint8Array(buffer, dataStart, compSize));
  }
  return files;
}

function renderMarkdown(md) {
  let html = md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`\n]+?)`/g, '<code>$1</code>')
    .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(.+)$/m, '<p>$1</p>');
  return html;
}

// ==================== EXAMPLE DOWNLOAD ====================

function downloadExamplePlugin() {
  const files = {
    'hello-world/manifest.json': JSON.stringify({
      name: 'hello-world',
      version: '1.0.0',
      description: 'Hello World example plugin',
      author: 'Florde',
      main: 'index.js',
      hooks: ['onMessage', 'onAppReady'],
      tools: [{
        type: 'function',
        function: {
          name: 'hello_world',
          description: 'Returns a friendly greeting',
          parameters: { type: 'object', properties: { name: { type: 'string', description: 'Name to greet' } }, required: ['name'] }
        }
      }],
      category: 'examples',
      icon: '👋'
    }, null, 2),
    'hello-world/index.js': `// Hello World plugin for Florde
console.log('Hello World plugin loaded!');
window.addEventListener('app-ready', () => console.log('Florde is ready!'));
pluginRegistry.registerTool('hello_world', async (args) => {
  return 'Hello, ' + (args.name || 'World') + '! Greetings from Florde.';
});
`,
    'hello-world/README.md': `# Hello World Plugin

A simple example plugin for Florde demonstrating manifest.json, tool registration, and event hooks.

## Installation
1. Open Florde → Plugins → Marketplace
2. Click "+ Upload" and select the ZIP file
3. Enable the plugin

## Usage
The plugin registers a \`hello_world\` tool.
`
  };

  const zip = createZip(files);
  const url = URL.createObjectURL(zip);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'hello-world-plugin.zip';
  a.click();
  URL.revokeObjectURL(url);
  showNotification('success', 'Downloading hello-world-plugin.zip', '📦');
}

// ==================== COMMUNITY REGISTRY ====================

const CommunityRegistry = {
  _indexUrl: 'https://raw.githubusercontent.com/florde/plugin-registry/main/index.json',
  _plugins: [],

  async fetch() {
    try {
      const response = await fetch(this._indexUrl);
      if (!response.ok) return [];
      this._plugins = (await response.json()).plugins || [];
      return this._plugins;
    } catch (e) {
      return [];
    }
  },

  async install(repoUrl) {
    try {
      const manifestUrl = repoUrl.replace(/\/$/, '') + '/raw/main/manifest.json';
      const manifest = await pluginRegistry.installFromUrl(manifestUrl);
      showNotification('success', 'Installed plugin: ' + manifest.name, '\u2713');
      renderPluginMarketplace();
      return manifest;
    } catch (e) {
      showNotification('error', 'Failed to install plugin: ' + e.message, '\u2715');
      return null;
    }
  }
};

// ==================== MARKETPLACE CATEGORIES ====================

function renderPluginMarketplace() {
  const container = document.getElementById('marketplace-list');
  if (!container) return;
  container.innerHTML = '';

  const allPlugins = pluginRegistry.list();

  // Category filter bar
  const categories = [...new Set(allPlugins.map(p => p.category || 'uncategorized'))];
  const filterBar = document.createElement('div');
  filterBar.className = 'marketplace-categories';
  filterBar.innerHTML = '<button class="cat-filter active" data-cat="all">All (' + allPlugins.length + ')</button>' +
    categories.map(c => '<button class="cat-filter" data-cat="' + c + '">' + c + ' (' + allPlugins.filter(p => (p.category || 'uncategorized') === c).length + ')</button>').join('');
  container.appendChild(filterBar);

  const activeCat = filterBar.querySelector('.cat-filter.active')?.dataset.cat || 'all';
  const filtered = activeCat === 'all' ? allPlugins : allPlugins.filter(p => (p.category || 'uncategorized') === activeCat);

  // Filtered content area
  const contentDiv = document.createElement('div');
  contentDiv.className = 'marketplace-content';
  container.appendChild(contentDiv);

  if (filtered.length === 0) {
    contentDiv.innerHTML = '<div style="color:var(--text3);padding:2rem;text-align:center;">No plugins in this category</div>';
    return;
  }

  // Featured section
  const featured = filtered.filter(p => p.featured && p.installed !== false);
  if (featured.length > 0) {
    const featuredTitle = document.createElement('div');
    featuredTitle.style.cssText = 'font-weight:600;color:var(--text2);font-size:0.85rem;padding:0.5rem;';
    featuredTitle.textContent = 'Featured';
    contentDiv.appendChild(featuredTitle);
    for (const p of featured) contentDiv.appendChild(renderPluginCard(p));
  }

  // Regular plugins
  const regular = filtered.filter(p => !p.featured);
  if (regular.length > 0) {
    if (featured.length > 0) {
      const sep = document.createElement('div');
      sep.style.cssText = 'border-bottom:1px solid var(--border);margin:0.5rem 0;';
      contentDiv.appendChild(sep);
    }
    for (const p of regular) contentDiv.appendChild(renderPluginCard(p));
  }

  // Category filter events
  filterBar.querySelectorAll('.cat-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      filterBar.querySelectorAll('.cat-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderPluginMarketplace(); // Re-render with new filter
    });
  });

  // Available section
  setupAvailableSection();
}

function setupAvailableSection() {
  const availableContainer = document.getElementById('available-plugins');
  if (!availableContainer) return;
  availableContainer.innerHTML = '';

  // Community tab
  const communityBtn = document.createElement('button');
  communityBtn.className = 'btn btn-sm btn-secondary';
  communityBtn.textContent = 'Browse Community Plugins';
  communityBtn.style.marginBottom = '0.5rem';
  communityBtn.addEventListener('click', async () => {
    communityBtn.textContent = 'Loading...';
    communityBtn.disabled = true;
    const plugins = await CommunityRegistry.fetch();
    communityBtn.textContent = 'Browse Community Plugins';
    communityBtn.disabled = false;
    availableContainer.innerHTML = '';
    if (plugins.length === 0) {
      availableContainer.innerHTML = '<div style="color:var(--text3);padding:1rem;text-align:center;font-size:0.85rem;">No community plugins available yet.</div>';
      return;
    }
    plugins.forEach(p => {
      const card = document.createElement('div');
      card.className = 'plugin-card';
      card.innerHTML = '<div class="plugin-card-icon" style="background:rgba(34,197,94,0.15);">\u{1F310}</div>' +
        '<div class="plugin-info">' +
          '<div class="plugin-name">' + p.name + ' <span style="font-size:0.7rem;color:var(--text3);">v' + p.version + '</span></div>' +
          '<div class="plugin-desc">' + (p.description || '') + '</div>' +
          '<div class="plugin-author">' + (p.author || 'Community') + ' \u00B7 ' + (p.downloads || 0) + ' downloads</div>' +
        '</div>' +
        '<button class="plugin-toggle community-install" data-url="' + p.repository + '">Install</button>';
      card.querySelector('.community-install')?.addEventListener('click', async () => {
        const btn = card.querySelector('.community-install');
        btn.textContent = 'Installing...';
        btn.disabled = true;
        await CommunityRegistry.install(p.repository);
      });
      availableContainer.appendChild(card);
    });
  });
  availableContainer.appendChild(communityBtn);
}
