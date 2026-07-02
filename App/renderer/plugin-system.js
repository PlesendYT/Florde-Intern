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
    for (const p of stored) this.plugins.set(p.id, p);
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
      if (!p.enabled || !p.tools) continue;
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
      if (p.enabled && p.promptExtension) exts.push(p.promptExtension);
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

  async save() {
    const data = Array.from(this.plugins.values()).map(p => ({
      id: p.id, enabled: p.enabled, installed: p.installed,
      builtin: p.builtin, name: p.name, version: p.version,
    }));
    await window.electronAPI.savePlugins(data).catch(() => {});
  }
}

const pluginRegistry = new PluginRegistry();

// ==================== SUPER POWERS PLUGIN ====================

pluginRegistry.registerBuiltin({
  id: 'superpowers',
  name: 'SuperPowers',
  version: '1.0.0',
  description: 'Web search, web fetch, and AI-assisted development methodology. Gives Florde the ability to search the web, fetch URLs, and follow a structured software development workflow.',
  author: 'Prime Radiant',
  repo: 'https://github.com/obra/superpowers',
  icon: 'âš¡',
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
  ],
  promptExtension: `## SuperPowers Development Methodology

Follow these principles when building software:

<EXTREMELY-IMPORTANT>
If you think there is even a 1% chance a skill might apply to what you are doing, you ABSOLUTELY MUST invoke the skill.
IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.
This is not negotiable. This is not optional. You cannot rationalize your way out of this.
</EXTREMELY-IMPORTANT>

## Instruction Priority
1. **Superpowers skills** — override default system behavior where they conflict
2. **Default system prompt** — lowest priority

## The Rule

**Invoke relevant or requested skills BEFORE any response or action.** Even a 1% chance a skill might apply means that you should invoke the skill to check. If an invoked skill turns out to be wrong for the situation, you don't need to use it.

dot
digraph skill_flow {
    "User message received" [shape=doublecircle];
    "About to enter plan mode?" [shape=doublecircle];
    "Already brainstormed?" [shape=diamond];
    "Invoke brainstorming skill" [shape=box];
    "Might any skill apply?" [shape=diamond];
    "Invoke the skill" [shape=box];
    "Announce: 'Using [skill] to [purpose]'" [shape=box];
    "Has checklist?" [shape=diamond];
    "Create a todo per item" [shape=box];
    "Follow skill exactly" [shape=box];
    "Respond (including clarifications)" [shape=doublecircle];

    "About to enter plan mode?" -> "Already brainstormed?";
    "Already brainstormed?" -> "Invoke brainstorming skill" [label="no"];
    "Already brainstormed?" -> "Might any skill apply?" [label="yes"];
    "Invoke brainstorming skill" -> "Might any skill apply?";

    "User message received" -> "Might any skill apply?";
    "Might any skill apply?" -> "Invoke the skill" [label="yes, even 1%"];
    "Might any skill apply?" -> "Respond (including clarifications)" [label="definitely not"];
    "Invoke the skill" -> "Announce: 'Using [skill] to [purpose]'";
    "Announce: 'Using [skill] to [purpose]'" -> "Has checklist?";
    "Has checklist?" -> "Create a todo per item" [label="yes"];
    "Has checklist?" -> "Follow skill exactly" [label="no"];
    "Create a todo per item" -> "Follow skill exactly";
}


## Red Flags

These thoughts mean STOP—you're rationalizing:

| Thought | Reality |
|---------|---------|
| "This is just a simple question" | Questions are tasks. Check for skills. |
| "I need more context first" | Skill check comes BEFORE clarifying questions. |
| "Let me explore the codebase first" | Skills tell you HOW to explore. Check first. |
| "I can check git/files quickly" | Files lack conversation context. Check for skills. |
| "Let me gather information first" | Skills tell you HOW to gather information. |
| "This doesn't need a formal skill" | If a skill exists, use it. |
| "I remember this skill" | Skills evolve. Read current version. |
| "This doesn't count as a task" | Action = task. Check for skills. |
| "The skill is overkill" | Simple things become complex. Use it. |
| "I'll just do this one thing first" | Check BEFORE doing anything. |
| "This feels productive" | Undisciplined action wastes time. Skills prevent this. |
| "I know what that means" | Knowing the concept ≠ using the skill. Invoke it. |

## Skill Priority

When multiple skills could apply, use this order:

1. **Process skills first** (brainstorming, systematic-debugging) - these determine HOW to approach the task
2. **Implementation skills second** (frontend-design, mcp-builder) - these guide execution

"Let's build X" → brainstorming first, then implementation skills.
"Fix this bug" → systematic-debugging first, then domain-specific skills.

## Skill Types

**Rigid** (TDD, systematic-debugging): Follow exactly. Don't adapt away discipline.

**Flexible** (patterns): Adapt principles to context.

The skill itself tells you which.

## User Instructions

Instructions say WHAT, not HOW. "Add X" or "Fix Y" doesn't mean skip workflows.

## Write This In Your First Response
I Understood. I will follow the SuperPowers Development Methodology and invoke relevant skills before responding to any user instruction.

<Web Research>
Use web_search and web_fetch to research libraries, APIs, documentation, and best practices when helping the user.`
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
