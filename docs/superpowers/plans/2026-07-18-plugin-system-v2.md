# Plugin System v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Erweitere das Plugin-System um Manifest-Permissions, PluginAPI, Commands, Themes, Accessibility-API und verbesserten Install-Flow.

**Architecture:** Bestehendes `PluginRegistry` wird erweitert; neues `PluginAPI` pro Plugin mit Permission-Gating; neuer `AccessibilityManager` für Built-in + Plugin-Features; `sendMessage()` erhält `/`-Detection.

**Tech Stack:** Vanilla JS (kein Framework), Electron Renderer, CSS Custom Properties

## Global Constraints

- Keine neuen externen Dependencies
- `plugin-system.js` bleibt die zentrale Datei
- Permission-Check passiert immer zur Laufzeit, nie nur im Manifest
- Jede PluginAPI-Methode prüft ihre Permission bevor sie ausführt
- Built-in Accessibility-Features sind Platzhalter (Framework + Plugin-API zuerst)

---

### Task 1: Manifest Validation & Permissions

**Files:**
- Modify: `App/renderer/plugin-system.js`

**Interfaces:**
- Consumes: Bestehende `PluginRegistry`-Klasse
- Produces: `_validateManifest(manifest)`, `_requiredPermissions`, `_activePermissions` pro Plugin

- [ ] **Step 1: Permissions-Konstanten definieren**

Füge oben in `plugin-system.js` die Liste aller bekannten Permissions:

```js
const PLUGIN_PERMISSIONS = [
  'files-read', 'files-write', 'network', 'terminal', 'git',
  'editor', 'other-plugins', 'florde-core', 'prompts', 'commands',
  'tools', 'renderer', 'notifications'
];

const PERMISSION_DESCRIPTIONS = {
  'files-read': 'Dateien lesen',
  'files-write': 'Dateien schreiben/löschen',
  'network': 'Netzwerkzugriff',
  'terminal': 'Shell-Befehle ausführen',
  'git': 'Git-Operationen',
  'editor': 'Editor/Tab-API',
  'other-plugins': 'Auf andere Plugins zugreifen',
  'florde-core': 'Core-API (Settings, Projekte)',
  'prompts': 'Prompt-Templates registrieren',
  'commands': 'Chat-Commands registrieren',
  'tools': 'KI-Tools registrieren',
  'renderer': 'DOM-Zugriff, UI-Manipulation',
  'notifications': 'Benachrichtigungen senden'
};
```

- [ ] **Step 2: Manifest-Validierung erweitern**

Füge Methode `_validateManifest(manifest)` hinzu:

```js
_validateManifest(manifest) {
  if (!manifest.id || !manifest.name) throw new Error('Invalid manifest: missing id or name');
  if (manifest.permissions) {
    if (!Array.isArray(manifest.permissions)) throw new Error('permissions must be an array');
    for (const p of manifest.permissions) {
      if (!PLUGIN_PERMISSIONS.includes(p)) throw new Error(`Unknown permission: ${p}`);
    }
  }
  if (manifest.apiVersion && manifest.apiVersion !== '2.0') {
    console.warn(`Plugin ${manifest.id} targets API ${manifest.apiVersion}, current is 2.0`);
  }
}
```

- [ ] **Step 3: `registerLocal()` um Validierung erweitern**

```js
registerLocal(manifest) {
  this._validateManifest(manifest);
  const id = manifest.id || 'local-' + Date.now();
  const activePerms = manifest.permissions ? [...manifest.permissions] : [];
  this.plugins.set(id, { ...manifest, id, builtin: false, enabled: true, installed: true, local: true, activePermissions: activePerms });
  this.save();
}
```

- [ ] **Step 4: `setPermission(id, perm, active)` Methode**

```js
setPermission(id, perm, active) {
  const p = this.plugins.get(id);
  if (!p) return;
  const perms = new Set(p.activePermissions || []);
  if (active) perms.add(perm);
  else perms.delete(perm);
  p.activePermissions = [...perms];
  this.plugins.set(id, p);
  this.save();
}
```

- [ ] **Step 5: `hasPermission(id, perm)` Helfer**

```js
hasPermission(id, perm) {
  const p = this.plugins.get(id);
  if (!p || p.enabled !== true) return false;
  return p.activePermissions ? p.activePermissions.includes(perm) : false;
}
```

- [ ] **Step 6: `save()` erweitern**

Aktualisiere `save()` um `activePermissions` und `categories`, `apiVersion`, `minFlordeVersion`, `license`, `dependencies` zu speichern:

```js
async save() {
  const data = Array.from(this.plugins.values()).map(p => ({
    id: p.id, enabled: p.enabled, installed: p.installed,
    builtin: p.builtin, name: p.name, version: p.version,
    activePermissions: p.activePermissions || (p.permissions ? [...p.permissions] : [])
  }));
  await window.electronAPI.savePlugins(data).catch(() => {});
}
```

- [ ] **Step 7: Commit**

```bash
git add App/renderer/plugin-system.js
git commit -m "feat(plugins): add manifest validation and permission system"
```

---

### Task 2: Permission UI in Plugin Card

**Files:**
- Modify: `App/renderer/plugin-system.js` (renderPluginCard)
- Modify: `App/renderer/style.css`

- [ ] **Step 1: `renderPermissionTable(plugin)` Helfer**

```js
function renderPermissionTable(plugin) {
  const perms = plugin.permissions || [];
  if (perms.length === 0) return '';
  const activePerms = new Set(plugin.activePermissions || perms);
  return '<div class="perm-table">' + perms.map(p => `
    <label class="perm-row">
      <input type="checkbox" class="perm-checkbox" data-perm="${p}" ${activePerms.has(p) ? 'checked' : ''}>
      <span class="perm-label">${PERMISSION_DESCRIPTIONS[p] || p}</span>
    </label>
  `).join('') + '</div>';
}
```

- [ ] **Step 2: Permission-Checkbox-Event-Handler**

In `setupPluginEventHandlers()`:

```js
document.addEventListener('change', (e) => {
  if (e.target.classList.contains('perm-checkbox')) {
    const pluginCard = e.target.closest('.plugin-card');
    const id = pluginCard?.querySelector('.plugin-toggle[data-action="toggle"]')?.dataset.id;
    if (!id) return;
    const perm = e.target.dataset.perm;
    pluginRegistry.setPermission(id, perm, e.target.checked);
  }
});
```

- [ ] **Step 3: PluginCard um Permission-Tabelle erweitern**

In `renderPluginCard()`, nach dem Plugin-Toggle-Button:

```js
div.innerHTML = `...${renderPermissionTable(plugin)}...`;
```

- [ ] **Step 4: CSS für Permission-Table**

In `style.css`:

```css
.perm-table { margin: 0.5rem 0; padding: 0.5rem; background: var(--bg2); border-radius: 6px; }
.perm-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.2rem 0; cursor: pointer; font-size: 0.78rem; color: var(--text2); }
.perm-row input[type="checkbox"] { accent-color: var(--accent); }
.perm-label { flex: 1; }
```

- [ ] **Step 5: Commit**

```bash
git add App/renderer/plugin-system.js App/renderer/style.css
git commit -m "feat(plugins): permission table UI with checkboxes"
```

---

### Task 3: PluginAPI

**Files:**
- Modify: `App/renderer/plugin-system.js`

**Interfaces:**
- Produces: `PluginAPI` class mit `create(pluginId, registry)` Factory
- Consumes: `pluginRegistry.hasPermission(id, perm)` aus Task 1

- [ ] **Step 1: PluginAPI-Klasse definieren**

```js
class PluginAPI {
  constructor(pluginId, registry) {
    this._id = pluginId;
    this._registry = registry;
    this._check = (perm) => {
      if (!this._registry.hasPermission(this._id, perm)) {
        throw new Error(`Plugin "${this._id}" fehlt Berechtigung: ${perm}`);
      }
    };
  }

  async execCommand(command) {
    this._check('terminal');
    const result = await window.api.runTerminalCommand(command);
    return result;
  }

  async readFile(path) {
    this._check('files-read');
    return await window.electronAPI.projectReadFile(currentProject, path);
  }

  async writeFile(path, content) {
    this._check('files-write');
    await window.electronAPI.projectWriteFile(currentProject, path, content);
  }

  async deleteFile(path) {
    this._check('files-write');
    await window.electronAPI.projectDeleteFile(currentProject, path);
  }

  async listFiles() {
    this._check('files-read');
    return await window.electronAPI.projectListFiles(currentProject);
  }

  async gitStatus() {
    this._check('git');
    return await window.electronAPI.gitStatus(currentProject);
  }

  async gitCommit(message) {
    this._check('git');
    await window.electronAPI.gitCommit(currentProject, message, '');
  }

  async gitPush() {
    this._check('git');
    await window.electronAPI.gitPush(currentProject, 'origin');
  }

  async gitPull() {
    this._check('git');
    await window.electronAPI.gitPull(currentProject, 'origin');
  }

  getOpenFiles() {
    this._check('editor');
    return [...openTabs];
  }

  getActiveFile() {
    this._check('editor');
    return openTabs[activeTabIndex] || null;
  }

  setActiveFile(path) {
    this._check('editor');
    const idx = openTabs.indexOf(path);
    if (idx >= 0) switchTab(idx);
  }

  async fetch(url, options) {
    this._check('network');
    return await fetch(url, options);
  }

  notify(title, body) {
    this._check('notifications');
    showNotification('info', body, title);
  }

  getPlugin(pluginId) {
    this._check('other-plugins');
    const p = this._registry.get(pluginId);
    return p ? new PluginAPI(pluginId, this._registry) : null;
  }

  getProjectName() {
    this._check('florde-core');
    return currentProject;
  }

  getSetting(key) {
    this._check('florde-core');
    try { return JSON.parse(localStorage.getItem('florde-settings') || '{}')[key]; } catch { return null; }
  }
}
```

- [ ] **Step 2: `getAPI(pluginId)` auf PluginRegistry**

```js
getAPI(pluginId) {
  const p = this.plugins.get(pluginId);
  if (!p || p.enabled !== true) return null;
  return new PluginAPI(pluginId, this);
}
```

- [ ] **Step 3: Commit**

```bash
git add App/renderer/plugin-system.js
git commit -m "feat(plugins): add PluginAPI with permission-gated methods"
```

---

### Task 4: registerPrompt, registerCommand & sendMessage /-Detection

**Files:**
- Modify: `App/renderer/plugin-system.js`
- Modify: `App/renderer/script.js`

**Interfaces:**
- Consumes: `PluginAPI` aus Task 3
- Produces: `pluginRegistry.registerPrompt()`, `pluginRegistry.registerCommand()`, `pluginRegistry.getCommands()`, `pluginRegistry.getPrompts()`

- [ ] **Step 1: `_commands` und `_prompts` Maps in PluginRegistry-Konstruktor**

```js
class PluginRegistry {
  constructor() {
    this.plugins = new Map();
    this.toolHandlers = new Map();
    this.promptExtensions = [];
    this._commands = new Map();    // name -> { handler, pluginId, options }
    this._prompts = new Map();     // name -> { text, pluginId, icon, enabled }
    this._loaded = false;
  }
```

- [ ] **Step 2: `registerPrompt()` und `registerCommand()`**

```js
registerPrompt(pluginId, name, config) {
  if (!this.hasPermission(pluginId, 'prompts')) {
    console.warn(`Plugin ${pluginId} fehlt prompts-Berechtigung`);
    return;
  }
  this._prompts.set(name, { ...config, pluginId, enabled: true });
}

registerCommand(pluginId, name, handler, options = {}) {
  if (!this.hasPermission(pluginId, 'commands')) {
    console.warn(`Plugin ${pluginId} fehlt commands-Berechtigung`);
    return;
  }
  this._commands.set(name, { handler, pluginId, options });
}

getCommands() {
  const result = [];
  for (const [name, cmd] of this._commands) {
    const p = this.plugins.get(cmd.pluginId);
    if (p && p.enabled) result.push({ name, ...cmd.options, pluginId: cmd.pluginId });
  }
  return result;
}

getPrompts() {
  const result = [];
  for (const [name, pr] of this._prompts) {
    const p = this.plugins.get(pr.pluginId);
    if (p && p.enabled && pr.enabled) result.push({ name, ...pr });
  }
  return result;
}

setPromptEnabled(name, enabled) {
  const pr = this._prompts.get(name);
  if (pr) { pr.enabled = enabled; this._prompts.set(name, pr); }
}
```

- [ ] **Step 3: Built-in Commands in `plugin-system.js`**

```js
const BUILTIN_COMMANDS = {
  'explain': { text: 'Erkläre den folgenden Code im Detail:\n\n```\n{{selection}}\n```', icon: '🔍' },
  'fix': { text: 'Finde und behebe Fehler im folgenden Code:\n\n```\n{{selection}}\n```', icon: '🔧' },
  'refactor': { text: 'Optimiere diesen Code hinsichtlich Performance und Lesbarkeit:\n\n```\n{{selection}}\n```', icon: '🔄' },
  'test': { text: 'Schreibe Tests für den folgenden Code:\n\n```\n{{selection}}\n```', icon: '🧪' },
  'doc': { text: 'Dokumentiere diese Funktion / diesen Code:\n\n```\n{{selection}}\n```', icon: '📝' }
};
```

- [ ] **Step 4: sendMessage `/`-Detection in script.js**

In `sendMessage()` in script.js, direkt nach `const input = document.getElementById('chat-input');`:

```js
async function sendMessage(text) {
  const input = document.getElementById('chat-input');
  if (!text) text = input?.value?.trim();
  if (!text) return;

  // Command detection
  if (text.startsWith('/')) {
    const spaceIdx = text.indexOf(' ');
    const cmdName = spaceIdx > 0 ? text.slice(1, spaceIdx) : text.slice(1);
    const args = spaceIdx > 0 ? text.slice(spaceIdx + 1) : '';

    // Built-in commands
    if (BUILTIN_COMMANDS[cmdName]) {
      const template = BUILTIN_COMMANDS[cmdName].text;
      let promptText = template.replace('{{selection}}', args || getEditorSelection() || '');
      input.value = '';
      text = promptText;
      // Fall through to normal sendMessage with the expanded text
    } else {
      // Plugin commands
      const commands = pluginRegistry.getCommands();
      const cmd = commands.find(c => c.name === cmdName);
      if (cmd) {
        input.value = '';
        const api = pluginRegistry.getAPI(cmd.pluginId);
        if (api) {
          try {
            const result = await cmd.handler(args, api);
            chatHistory.push({ role: 'user', content: '/' + cmdName + ' ' + args });
            chatHistory.push({ role: 'assistant', content: String(result) });
          } catch (e) {
            chatHistory.push({ role: 'assistant', content: 'Fehler: ' + e.message });
          }
        }
        renderChat();
        return;
      }
    }
  }

  // ... rest of sendMessage
}
```

- [ ] **Step 5: `getEditorSelection()` Helfer**

```js
function getEditorSelection() {
  if (editor) {
    const sel = editor.getSelection();
    if (sel && !sel.isEmpty()) return editor.getModel().getValueInRange(sel);
  }
  return '';
}
```

- [ ] **Step 6: Commit**

```bash
git add App/renderer/plugin-system.js App/renderer/script.js
git commit -m "feat(plugins): add prompt/command registration and /-detection in chat"
```

---

### Task 5: Chat Command Autocomplete

**Files:**
- Modify: `App/renderer/script.js`

- [ ] **Step 1: Autocomplete-Dropdown in chat-input Event**

In der `chatInput?.addEventListener('keydown', ...)` Stelle (ca. Zeile 3640):

```js
chatInput?.addEventListener('input', () => {
  updateTokenCount();
  autoResizeTextarea(chatInput);
  showCommandAutocomplete(chatInput);
});

function showCommandAutocomplete(input) {
  const val = input.value;
  if (!val.startsWith('/')) {
    document.getElementById('cmd-autocomplete')?.remove();
    return;
  }
  const partial = val.slice(1).toLowerCase();
  const allCommands = [
    ...Object.entries(BUILTIN_COMMANDS).map(([name, c]) => ({ name, ...c, builtin: true })),
    ...pluginRegistry.getCommands()
  ];
  const matches = allCommands.filter(c => c.name.startsWith(partial));
  if (matches.length === 0 || partial === '') {
    document.getElementById('cmd-autocomplete')?.remove();
    return;
  }
  let el = document.getElementById('cmd-autocomplete');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cmd-autocomplete';
    el.className = 'cmd-autocomplete';
    input.parentNode.appendChild(el);
  }
  el.innerHTML = matches.map(c => `
    <div class="cmd-autocomplete-item" data-cmd="${c.name}">
      <span class="cmd-autocomplete-icon">${c.icon || '💻'}</span>
      <span class="cmd-autocomplete-name">/${c.name}</span>
      <span class="cmd-autocomplete-desc">${c.builtin ? 'Built-in' : (c.pluginId || '')}</span>
    </div>
  `).join('');
  el.querySelectorAll('.cmd-autocomplete-item').forEach(item => {
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      input.value = '/' + item.dataset.cmd + ' ';
      el.remove();
      input.focus();
    });
  });
}
```

- [ ] **Step 2: CSS für Autocomplete**

```css
.cmd-autocomplete {
  position: absolute; bottom: 100%; left: 0; right: 0;
  background: var(--bg2); border: 1px solid var(--border);
  border-radius: 8px; max-height: 200px; overflow-y: auto;
  z-index: 100; margin-bottom: 0.25rem;
}
.cmd-autocomplete-item {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.4rem 0.75rem; cursor: pointer; font-size: 0.85rem;
}
.cmd-autocomplete-item:hover { background: var(--bg3); }
.cmd-autocomplete-icon { font-size: 1rem; }
.cmd-autocomplete-name { font-weight: 500; color: var(--text); }
.cmd-autocomplete-desc { margin-left: auto; font-size: 0.7rem; color: var(--text3); }
```

- [ ] **Step 3: chat-input Container als `position: relative` setzen**

CSS für `#chat-input-container` oder dem Parent:

```css
.chat-input-wrapper { position: relative; }
```

- [ ] **Step 4: Commit**

```bash
git add App/renderer/script.js App/renderer/style.css
git commit -m "feat(plugins): chat command autocomplete dropdown"
```

---

### Task 6: registerTheme & applyTheme Support

**Files:**
- Modify: `App/renderer/plugin-system.js`
- Modify: `App/renderer/script.js` (applyTheme, theme selector)

- [ ] **Step 1: `_themes` Map und `registerTheme()`**

In PluginRegistry:

```js
this._themes = new Map(); // themeId -> { id, name, type, colors, pluginId }

registerTheme(pluginId, config) {
  if (!this.hasPermission(pluginId, 'renderer')) {
    console.warn(`Plugin ${pluginId} fehlt renderer-Berechtigung für Themes`);
    return;
  }
  if (!config.id || !config.name || !config.colors) {
    console.warn(`Invalid theme config from plugin ${pluginId}`);
    return;
  }
  this._themes.set(config.id, { ...config, pluginId });
}

getPluginThemes() {
  const themes = [];
  for (const [id, theme] of this._themes) {
    const p = this.plugins.get(theme.pluginId);
    if (p && p.enabled) themes.push(theme);
  }
  return themes;
}

hasTheme(id) {
  return this._themes.has(id);
}

getTheme(id) {
  return this._themes.get(id) || null;
}
```

- [ ] **Step 2: Theme-Selector mit Plugin-Themes füllen**

In `script.js` bei der Settings-Initialisierung (ca. Zeile 5924):

```js
function populateThemeSelector() {
  const sel = document.getElementById('settings-theme');
  if (!sel) return;
  const currentVal = sel.value;
  // Built-in themes bleiben erhalten
  const builtinThemes = ['dark', 'light', 'solarized-dark', 'solarized-light'];
  const pluginThemes = typeof pluginRegistry !== 'undefined' ? pluginRegistry.getPluginThemes() : [];
  sel.innerHTML = '';
  builtinThemes.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t.charAt(0).toUpperCase() + t.slice(1).replace('-', ' ');
    sel.appendChild(opt);
  });
  pluginThemes.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name + ' (Plugin)';
    sel.appendChild(opt);
  });
  sel.value = currentVal || 'dark';
}

// Aufruf nach pluginRegistry.init() und bei Re-renders
```

- [ ] **Step 3: `applyTheme()` um Plugin-Themes erweitern**

```js
function applyTheme() {
  const themeId = currentTheme || 'dark';
  if (typeof pluginRegistry !== 'undefined' && pluginRegistry.hasTheme(themeId)) {
    const theme = pluginRegistry.getTheme(themeId);
    document.documentElement.removeAttribute('data-theme');
    for (const [key, val] of Object.entries(theme.colors)) {
      document.documentElement.style.setProperty(key, val);
    }
  } else {
    document.documentElement.style.cssText = ''; // reset plugin theme vars
    document.documentElement.setAttribute('data-theme', themeId);
  }
  const isLight = themeId === 'light' || themeId === 'solarized-light';
  document.getElementById('btn-theme-toggle') && (document.getElementById('btn-theme-toggle').textContent = isLight ? '\u263D' : '\u2600');
  if (editor) {
    const monacoTheme = isLight ? 'vs' : 'vs-dark';
    monaco.editor.setTheme(monacoTheme);
  }
}
```

- [ ] **Step 4: `__updateTools` auch theme selector updaten**

In `window.__updateTools`:

```js
window.__updateTools = function() {
  if (typeof pluginRegistry !== 'undefined' && pluginRegistry._loaded) {
    if (document.getElementById('marketplace-list')) renderPluginMarketplace();
    populateThemeSelector();
  }
  // ...
};
```

- [ ] **Step 5: Commit**

```bash
git add App/renderer/plugin-system.js App/renderer/script.js
git commit -m "feat(plugins): add theme registration and plugin theme support"
```

---

### Task 7: AccessibilityManager & registerAccessibility

**Files:**
- Create: `App/renderer/tools/accessibility-manager.js`
- Modify: `App/renderer/index.html` (Accessibility-Panel Modal)
- Modify: `App/renderer/plugin-system.js`
- Modify: `App/renderer/style.css`

- [ ] **Step 1: AccessibilityManager-Klasse**

```js
// App/renderer/tools/accessibility-manager.js

const AccessibilityManager = {
  _features: new Map(), // featureId -> config
  _values: new Map(),   // featureId -> current value
  _categories: {
    'sehen': { label: 'Sehen', icon: '👁️' },
    'hören': { label: 'Hören', icon: '🔊' },
    'motorik': { label: 'Motorik', icon: '🖱️' },
    'kognition': { label: 'Kognition', icon: '🧠' },
    'sprache': { label: 'Sprache', icon: '🌍' },
    'allgemein': { label: 'Allgemein', icon: '⚙️' }
  },

  init() {
    this._loadValues();
  },

  _loadValues() {
    try {
      this._values = new Map(Object.entries(JSON.parse(localStorage.getItem('florde-a11y-values') || '{}')));
    } catch { this._values = new Map(); }
  },

  _saveValues() {
    localStorage.setItem('florde-a11y-values', JSON.stringify(Object.fromEntries(this._values)));
  },

  register(feature) {
    if (!feature.id || !feature.name || !feature.category) {
      console.warn('Invalid accessibility feature config');
      return;
    }
    if (!this._categories[feature.category]) {
      console.warn(`Unknown accessibility category: ${feature.category}`);
      return;
    }
    this._features.set(feature.id, feature);
    // Load saved value or use default
    if (!this._values.has(feature.id)) {
      this._values.set(feature.id, feature.default ?? (feature.type === 'toggle' ? false : null));
    }
  },

  getValue(featureId) {
    return this._values.get(featureId);
  },

  setValue(featureId, value) {
    this._values.set(featureId, value);
    this._saveValues();
    const feature = this._features.get(featureId);
    if (feature && feature.apply) feature.apply(value);
  },

  getFeaturesByCategory(category) {
    return [...this._features.values()].filter(f => f.category === category);
  },

  getAllCategories() {
    return Object.entries(this._categories);
  },

  hasFeature(id) {
    return this._features.has(id);
  }
};
```

- [ ] **Step 2: `registerAccessibility()` in PluginRegistry**

```js
registerAccessibility(pluginId, config) {
  if (!this.hasPermission(pluginId, 'renderer')) {
    console.warn(`Plugin ${pluginId} fehlt renderer-Berechtigung für Accessibility`);
    return;
  }
  if (typeof AccessibilityManager !== 'undefined') {
    AccessibilityManager.register(config);
  }
}
```

- [ ] **Step 3: Accessibility-Panel HTML in index.html**

Füge Modal ein:

```html
<div id="accessibility-modal" class="modal hidden">
  <div class="modal-content" style="max-width:700px;">
    <div class="modal-header">
      <h2>Accessibility</h2>
      <button class="btn btn-sm btn-secondary" onclick="hideModal('accessibility-modal')">&times;</button>
    </div>
    <div id="accessibility-categories" class="a11y-categories"></div>
    <div id="accessibility-content" class="a11y-content"></div>
  </div>
</div>
```

- [ ] **Step 4: Accessibility-Panel Render-Funktion**

In `accessibility-manager.js`:

```js
render() {
  const container = document.getElementById('accessibility-categories');
  const content = document.getElementById('accessibility-content');
  if (!container || !content) return;

  container.innerHTML = this.getAllCategories().map(([key, cat]) =>
    `<button class="a11y-cat-btn" data-cat="${key}">${cat.icon} ${cat.label}</button>`
  ).join('');

  // Aktivate first category
  const firstCat = this.getAllCategories()[0];
  if (firstCat) this.renderCategory(firstCat[0], content);

  container.querySelectorAll('.a11y-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.a11y-cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this.renderCategory(btn.dataset.cat, content);
    });
  });
}

renderCategory(category, contentEl) {
  const features = this.getFeaturesByCategory(category);
  if (features.length === 0) {
    contentEl.innerHTML = '<div style="color:var(--text3);padding:1rem;">Keine Optionen in dieser Kategorie</div>';
    return;
  }
  contentEl.innerHTML = features.map(f => this._renderFeature(f)).join('');
  // Bind events
  features.forEach(f => {
    const el = contentEl.querySelector(`[data-feature="${f.id}"]`);
    if (!el) return;
    const input = el.querySelector('input, select');
    if (!input) return;
    input.addEventListener('change', () => {
      const val = input.type === 'checkbox' ? input.checked : input.value;
      this.setValue(f.id, val);
    });
  });
}

_renderFeature(f) {
  const val = this.getValue(f.id);
  let control = '';
  if (f.type === 'toggle') {
    control = `<label class="a11y-toggle"><input type="checkbox" ${val ? 'checked' : ''}><span class="a11y-toggle-slider"></span></label>`;
  } else if (f.type === 'slider') {
    control = `<input type="range" min="${f.min || 0}" max="${f.max || 100}" step="${f.step || 1}" value="${val ?? f.default ?? 0}">`;
  } else if (f.type === 'select' && f.options) {
    control = `<select>${f.options.map(o => `<option value="${o.value}" ${val === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}</select>`;
  }
  return `<div class="a11y-feature" data-feature="${f.id}">
    <div class="a11y-feature-info">
      <div class="a11y-feature-name">${f.name}</div>
      ${f.description ? `<div class="a11y-feature-desc">${f.description}</div>` : ''}
    </div>
    <div class="a11y-feature-control">${control}</div>
  </div>`;
}
```

- [ ] **Step 5: CSS für Accessibility-Panel**

```css
.a11y-categories { display: flex; gap: 0.5rem; flex-wrap: wrap; padding: 0.5rem; border-bottom: 1px solid var(--border); }
.a11y-cat-btn { padding: 0.4rem 0.75rem; border: 1px solid var(--border); border-radius: 6px; background: var(--bg2); color: var(--text2); cursor: pointer; font-size: 0.8rem; }
.a11y-cat-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
.a11y-content { padding: 0.75rem; max-height: 400px; overflow-y: auto; }
.a11y-feature { display: flex; align-items: center; justify-content: space-between; padding: 0.6rem 0; border-bottom: 1px solid var(--border); }
.a11y-feature:last-child { border-bottom: none; }
.a11y-feature-info { flex: 1; }
.a11y-feature-name { font-weight: 500; font-size: 0.85rem; color: var(--text); }
.a11y-feature-desc { font-size: 0.75rem; color: var(--text3); margin-top: 0.15rem; }
.a11y-feature-control { margin-left: 1rem; }
.a11y-toggle { position: relative; display: inline-block; width: 40px; height: 22px; cursor: pointer; }
.a11y-toggle input { opacity: 0; width: 0; height: 0; }
.a11y-toggle-slider { position: absolute; inset: 0; background: var(--bg3); border-radius: 22px; transition: 0.2s; }
.a11y-toggle input:checked + .a11y-toggle-slider { background: var(--accent); }
.a11y-toggle-slider::before { content: ''; position: absolute; left: 2px; top: 2px; width: 18px; height: 18px; background: #fff; border-radius: 50%; transition: 0.2s; }
.a11y-toggle input:checked + .a11y-toggle-slider::before { transform: translateX(18px); }
```

- [ ] **Step 6: Button in Settings/UI to open accessibility**

In `index.html`:

```html
<button id="btn-accessibility" class="btn btn-sm btn-secondary">Accessibility</button>
```

In `script.js`:

```js
document.getElementById('btn-accessibility')?.addEventListener('click', () => {
  hideAllModals();
  showModal('accessibility-modal');
  AccessibilityManager.render();
});
```

- [ ] **Step 7: script.js load accessibility-manager**

Lade neue Datei in `index.html`:

```html
<script src="tools/accessibility-manager.js"></script>
```

Und `AccessibilityManager.init()` in `app-ready` oder beim Start aufrufen.

- [ ] **Step 8: Commit**

```bash
git add App/renderer/tools/accessibility-manager.js App/renderer/index.html App/renderer/plugin-system.js App/renderer/style.css
git commit -m "feat(plugins): add AccessibilityManager and registerAccessibility API"
```

---

### Task 8: Enhanced Install Flow

**Files:**
- Modify: `App/renderer/plugin-system.js`
- Modify: `App/renderer/style.css`

- [ ] **Step 1: Manifest-Changelog-Vergleich**

```js
_checkPluginUpdate(manifest) {
  const existing = this.plugins.get(manifest.id);
  if (!existing) return null;
  const oldVersion = existing.version || '0.0.0';
  if (oldVersion === manifest.version) return null;
  const changelog = (manifest.changelog || []).filter(c => {
    try { return semverGt(c.version, oldVersion); } catch { return false; }
  });
  const newPerms = [];
  for (const entry of changelog) {
    if (entry.newPermissions) newPerms.push(...entry.newPermissions);
  }
  return { oldVersion, newVersion: manifest.version, changelog, newPermissions: [...new Set(newPerms)] };
}

// Simple semver comparison
function semverGt(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}
```

- [ ] **Step 2: Hold-to-Install UI**

```js
function showInstallConfirmDialog(manifest, updateInfo) {
  const overlay = document.createElement('div');
  overlay.className = 'install-overlay';
  overlay.innerHTML = `
    <div class="install-dialog">
      <h3>${updateInfo ? 'Update: ' + manifest.name : 'Plugin installieren: ' + manifest.name}</h3>
      ${updateInfo ? renderUpdateInfo(updateInfo) : ''}
      <div class="install-permissions">
        <h4>Berechtigungen</h4>
        ${renderPermissionTable({ permissions: manifest.permissions || [], activePermissions: manifest.permissions || [] })}
      </div>
      <div class="install-capabilities">
        ${manifest.capabilities ? '<h4>Benötigt: ' + manifest.capabilities.join(', ') + '</h4>' : ''}
        ${manifest.dependencies ? '<h4>Abhängigkeiten: ' + manifest.dependencies.join(', ') + '</h4>' : ''}
      </div>
      <div class="install-warning">
        ⚠ Dieses Plugin stammt aus einer lokalen Quelle und wurde nicht geprüft.
        <button class="btn btn-sm btn-secondary" onclick="explainPluginFromCode()">Plugin erklären (KI)</button>
      </div>
      <button class="btn btn-primary hold-to-install" id="btn-hold-install">
        <span class="hold-text">Installation bestätigen</span>
        <span class="hold-progress"></span>
      </button>
      <button class="btn btn-secondary" onclick="this.closest('.install-overlay').remove()">Abbrechen</button>
    </div>
  `;
  document.body.appendChild(overlay);
  setupHoldToInstall(overlay, manifest, updateInfo);
}
```

- [ ] **Step 3: Hold-to-Install Mechanik**

```js
function setupHoldToInstall(overlay, manifest, updateInfo) {
  const btn = overlay.querySelector('#btn-hold-install');
  const progress = btn.querySelector('.hold-progress');
  let holdTimer = null;
  let holdStart = 0;

  function onStart(e) {
    e.preventDefault();
    holdStart = Date.now();
    btn.classList.add('holding');
    holdTimer = setInterval(() => {
      const elapsed = Date.now() - holdStart;
      const pct = Math.min(100, (elapsed / 5000) * 100);
      progress.style.width = pct + '%';
      if (pct >= 100) {
        clearInterval(holdTimer);
        onComplete();
      }
    }, 30);
  }

  function onEnd(e) {
    e.preventDefault();
    clearInterval(holdTimer);
    btn.classList.remove('holding');
    progress.style.width = '0';
  }

  function onComplete() {
    overlay.querySelector('.install-dialog').innerHTML = `
      <h3>Plugin wirklich installieren?</h3>
      <p>Möchtest du <strong>${manifest.name}</strong> wirklich installieren?</p>
      <div style="display:flex;gap:0.5rem;margin-top:1rem;">
        <button class="btn btn-primary" id="btn-confirm-install">Ja, installieren</button>
        <button class="btn btn-secondary" onclick="this.closest('.install-overlay').remove()">Abbrechen</button>
      </div>
    `;
    overlay.querySelector('#btn-confirm-install').addEventListener('click', () => {
      finishInstall(manifest, updateInfo);
      overlay.remove();
    });
  }

  btn.addEventListener('mousedown', onStart);
  btn.addEventListener('mouseup', onEnd);
  btn.addEventListener('mouseleave', onEnd);
  btn.addEventListener('touchstart', onStart);
  btn.addEventListener('touchend', onEnd);
}
```

- [ ] **Step 4: Explain-Plugin-Funktion**

```js
async function explainPluginFromCode() {
  const overlay = document.querySelector('.install-overlay');
  if (!overlay) return;
  const manifestEl = overlay.querySelector('.install-dialog');
  // Extract plugin code from the loaded files
  const pluginData = window._pendingPluginData;
  if (!pluginData) return;

  const codeSummary = Object.entries(pluginData.files || {})
    .map(([name, content]) => `--- ${name} ---\n${content.slice(0, 2000)}`)
    .join('\n\n');

  const providerId = document.getElementById('provider-select')?.value;
  const prov = providerId ? providers[providerId] : null;
  if (!prov) { showNotification('error', 'Kein KI-Provider aktiviert', '⚠'); return; }

  const bubble = document.createElement('div');
  bubble.className = 'explain-bubble';
  bubble.innerHTML = '<div class="explain-bubble-content">Analysiere Code...</div>';
  manifestEl.appendChild(bubble);

  try {
    const result = await prov.sendPlain([
      { role: 'system', content: 'Analysiere das folgende Plugin. Beschreibe kurz: 1) Was macht es? 2) Welche Risiken gibt es? 3) Welche Vorteile hat es? Antworte auf Deutsch, maximal 5 Sätze, für technisch interessierte Nutzer.' },
      { role: 'user', content: codeSummary }
    ]);
    bubble.innerHTML = `<div class="explain-bubble-content">${escapeHtml(result)}</div>`;
  } catch (e) {
    bubble.innerHTML = '<div class="explain-bubble-content" style="color:var(--error);">Fehler: ' + escapeHtml(e.message) + '</div>';
  }
}
```

- [ ] **Step 5: Install-Abschluss**

```js
function finishInstall(manifest, updateInfo) {
  if (updateInfo) {
    const existing = pluginRegistry.get(manifest.id);
    pluginRegistry.plugins.set(manifest.id, {
      ...existing, ...manifest,
      activePermissions: manifest.permissions ? [...manifest.permissions] : (existing.activePermissions || [])
    });
  } else {
    pluginRegistry.registerLocal(manifest);
  }
  pluginRegistry.save();
  renderPluginMarketplace();
  logToTerminal(`Plugin "${manifest.name}" ${updateInfo ? 'aktualisiert' : 'installiert'}`, 'success');
}
```

- [ ] **Step 6: Upload-Handler aktualisieren**

In der bestehenden Upload-Logik (aus ZIP/Ordner parsen):

```js
async function handlePluginUpload(files) {
  const manifest = JSON.parse(files['manifest.json']);
  if (!manifest || !manifest.id) throw new Error('Invalid manifest.json');

  const updateInfo = pluginRegistry._checkPluginUpdate(manifest);
  if (updateInfo && updateInfo.newPermissions.length > 0) {
    // Neue Berechtigungen — erneute Zustimmung
    showInstallConfirmDialog(manifest, updateInfo);
    return;
  }

  window._pendingPluginData = { files, manifest };
  showInstallConfirmDialog(manifest, updateInfo);
}
```

- [ ] **Step 7: CSS für Install-Overlay**

```css
.install-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.install-dialog {
  background: var(--bg2); border-radius: 12px; padding: 1.5rem;
  max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;
}
.install-dialog h3 { margin: 0 0 0.75rem; }
.install-warning { padding: 0.5rem; background: rgba(234,179,8,0.1); border-radius: 6px; margin: 0.5rem 0; font-size: 0.8rem; color: var(--warning); }
.hold-to-install { position: relative; overflow: hidden; width: 100%; margin: 0.5rem 0; padding: 0.75rem; }
.hold-to-install .hold-text { position: relative; z-index: 1; }
.hold-to-install .hold-progress {
  position: absolute; left: 0; top: 0; bottom: 0; width: 0;
  background: rgba(255,255,255,0.15); transition: none;
}
.hold-to-install.holding .hold-progress { background: var(--accent); }
.explain-bubble {
  margin: 0.5rem 0; padding: 0.75rem; background: var(--bg3);
  border-radius: 8px; border-left: 3px solid var(--accent);
  font-size: 0.85rem; line-height: 1.5;
}
```

- [ ] **Step 8: Commit**

```bash
git add App/renderer/plugin-system.js App/renderer/style.css
git commit -m "feat(plugins): enhanced install flow with hold-to-install and KI explain"
```

---

### Task 9: Plugin Docs Update

**Files:**
- Modify: `App/renderer/plugin-system.js` (PluginDocs._content)

- [ ] **Step 1: Neue Docs-Sektionen**

Erweitere `PluginDocs._content`:

```js
const PluginDocs = {
  _content: {
    // ... existing entries ...

    'permissions': '# Permissions\n\nPlugins müssen im Manifest deklarieren, welche Berechtigungen sie benötigen:\n\n| Permission | Beschreibung |\n|---|---|\n| `files-read` | Dateien lesen |\n| `files-write` | Dateien schreiben/löschen |\n| `network` | Netzwerkzugriff (fetch) |\n| `terminal` | Shell-Befehle ausführen |\n| `git` | Git-Operationen |\n| `editor` | Editor/Tab-API |\n| `other-plugins` | Auf andere Plugins zugreifen |\n| `florde-core` | Core-API (Settings, Projekte) |\n| `prompts` | Prompt-Templates registrieren |\n| `commands` | Chat-Commands registrieren |\n| `tools` | KI-Tools registrieren |\n| `renderer` | DOM-Zugriff, UI-Manipulation |\n| `notifications` | Benachrichtigungen senden |\n\nDer Nutzer kann einzelne Berechtigungen deaktivieren. Das Plugin kann dann nicht auf deaktivierte Berechtigungen zugreifen.',

    'api-reference': '# PluginAPI Referenz\n\nDas PluginAPI-Objekt wird an Command-Handler übergeben:\n\n## Dateien\n- `api.readFile(path)` → String\n- `api.writeFile(path, content)`\n- `api.deleteFile(path)`\n- `api.listFiles()` → String[]\n\n## Terminal\n- `api.execCommand(command)` → { stdout, stderr, code }\n\n## Git\n- `api.gitStatus()`\n- `api.gitCommit(message)`\n- `api.gitPush()`\n- `api.gitPull()`\n\n## Editor\n- `api.getOpenFiles()` → String[]\n- `api.getActiveFile()` → String|null\n- `api.setActiveFile(path)`\n\n## Weitere\n- `api.fetch(url, options)` → Response\n- `api.notify(title, body)`\n- `api.getPlugin(pluginId)` → PluginAPI|null\n- `api.getProjectName()` → String\n- `api.getSetting(key)` → any',

    'commands': '# Chat Commands\n\nPlugins können `/`-Commands in der Chatleiste registrieren:\n\n```javascript\npluginRegistry.registerCommand(pluginId, "deploy", async (args, api) => {\n  const result = await api.execCommand("npm run build");\n  return "Build output: " + result.stdout;\n}, { description: "Build und deploy", permission: "terminal" });\n```\n\nBuilt-in Commands:\n- `/explain` — Code erklären\n- `/fix` — Fehler beheben\n- `/refactor` — Code optimieren\n- `/test` — Tests schreiben\n- `/doc` — Code dokumentieren',

    'themes': '# Themes\n\nPlugins können eigene Themes registrieren:\n\n```javascript\npluginRegistry.registerTheme(pluginId, {\n  id: "my-dark-theme",\n  name: "My Dark Theme",\n  type: "dark",\n  colors: {\n    "--bg": "#1a1a2e",\n    "--bg2": "#16213e",\n    "--text": "#e0e0e0",\n    "--accent": "#7c3aed"\n  }\n});\n```\n\nDas Theme erscheint automatisch im Theme-Selector in den Einstellungen. Es benötigt die `renderer`-Berechtigung.',

    'accessibility': '# Accessibility\n\nPlugins können eigene Accessibility-Features registrieren:\n\n```javascript\npluginRegistry.registerAccessibility(pluginId, {\n  id: "my-high-contrast",\n  name: "Extra High Contrast",\n  description: "Erhöht den Kontrast weiter",\n  category: "sehen",\n  type: "toggle",\n  default: false,\n  apply: (value) => {\n    document.documentElement.classList.toggle("extra-contrast", value);\n  }\n});\n```\n\nKategorien: `sehen`, `hören`, `motorik`, `kognition`, `sprache`, `allgemein`\n\nTypes: `toggle`, `slider`, `select`, `color`\n\nEs benötigt die `renderer`-Berechtigung.',

    'manifest-v2': '# Manifest v2\n\nSeit API v2 enthält das Manifest zusätzliche Felder:\n\n```json\n{\n  "apiVersion": "2.0",\n  "minFlordeVersion": "1.0.0",\n  "license": "MIT",\n  "categories": ["development", "design"],\n  "permissions": ["files-read", "terminal"],\n  "capabilities": ["terminal", "git"],\n  "dependencies": ["other-plugin-id"],\n  "changelog": [\n    {\n      "version": "1.1.0",\n      "features": ["Neues Feature"],\n      "newPermissions": ["network"]\n    }\n  ]\n}\n```\n\n- `permissions`: Berechtigungen, die das Plugin benötigt\n- `capabilities`: System-Features, die genutzt werden\n- `dependencies`: IDs anderer Plugins, die installiert sein müssen\n- `apiVersion`: Ziel-API-Version (aktuell: 2.0)\n- `changelog`: Versionshistorie für Update-Benachrichtigungen'
  },
  // ...
};
```

- [ ] **Step 2: Sidebar-Links für neue Docs**

```js
// In show() oder im HTML
'<li><a class="docs-link" data-doc="manifest-v2">Manifest v2</a></li>' +
'<li><a class="docs-link" data-doc="permissions">Permissions</a></li>' +
'<li><a class="docs-link" data-doc="api-reference">PluginAPI</a></li>' +
'<li><a class="docs-link" data-doc="commands">Commands</a></li>' +
'<li><a class="docs-link" data-doc="themes">Themes</a></li>' +
'<li><a class="docs-link" data-doc="accessibility">Accessibility</a></li>'
```

- [ ] **Step 3: Commit**

```bash
git add App/renderer/plugin-system.js
git commit -m "docs(plugins): add plugin docs for v2 features"
```
