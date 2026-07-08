# V2 Remaining Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement remaining V2 spec features: Model Info Indicator, Free/API-Key Indicator, AI Activity Display, and Confirmation Descriptions.

**Architecture:** All changes in `App/renderer/script.js` (renderer process), `App/renderer/style.css`, `App/renderer/index.html`. No backend changes needed.

**Tech Stack:** Vanilla JS + Monaco Editor + Electron IPC

## Global Constraints

- No build step — all code is loaded directly from `.js`/`.html`/`.css`
- Follow existing patterns (provider classes, settings system, permission system)
- No external dependencies
- All settings persisted via `localStorage`

---

### Task 1: Model Info Indicator

**Files:**
- Modify: `App/renderer/script.js` — add model info data + popup UI
- Modify: `App/renderer/style.css` — styles for the info popup
- Modify: `App/renderer/index.html` — info trigger element in settings

**Interfaces:**
- Consumes: `capabilityCache` (already populated by `detectCapabilities`), provider list in settings HTML
- Produces: `showModelInfo(providerId)` function that renders a details modal

- [ ] **Step 1: Add model metadata map**

Add a `MODEL_META` object in the provider section of `script.js` (around line 1460) with known model data:

```js
const MODEL_META = {
  'gpt-4o': { context: 128000, costIn: 2.5, costOut: 10, free: false },
  'gpt-4o-mini': { context: 128000, costIn: 0.15, costOut: 0.6, free: false },
  'gpt-5.5': { context: 256000, costIn: 5, costOut: 20, free: false },
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
```

- [ ] **Step 2: Add `showModelInfo` function**

Insert after `updateProviderDropdown` function (around line 1775):

```js
function showModelInfo(providerId, modelName) {
  const cap = capabilityCache[providerId + ':' + modelName];
  const meta = MODEL_META[modelName];
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const caps = cap ? Object.entries(cap).filter(([k, v]) => typeof v === 'boolean').map(([k, v]) => '<span class="cap-badge ' + (v ? 'cap-yes' : 'cap-no') + '">' + k.replace(/_/g, ' ') + '</span>').join('') : '<span class="cap-badge cap-no">unknown</span>';
  overlay.innerHTML = '<div class="modal-content model-info-modal"><h2>' + escapeHtml(modelName) + '</h2>' +
    '<div class="model-info-grid">' +
    (meta ? '<div class="info-row"><span class="info-label">Context Window</span><span class="info-value">' + (meta.context / 1000).toFixed(0) + 'K tokens</span></div>' +
      '<div class="info-row"><span class="info-label">Input Cost</span><span class="info-value">' + (meta.free ? 'Free' : '$' + meta.costIn + '/M tokens') + '</span></div>' +
      '<div class="info-row"><span class="info-label">Output Cost</span><span class="info-value">' + (meta.free ? 'Free' : '$' + meta.costOut + '/M tokens') + '</span></div>' +
      (meta.local ? '<div class="info-row"><span class="info-label">Type</span><span class="info-value">Local (Ollama)</span></div>' : '') : '<div class="info-row"><span class="info-label">Context</span><span class="info-value">Unknown</span></div>') +
    '<div class="info-row"><span class="info-label">Capabilities</span><span class="info-value caps-list">' + caps + '</span></div>' +
    '</div>' +
    '<div class="modal-actions"><button class="btn btn-secondary close-model-info">Close</button></div></div>';
  document.body.appendChild(overlay);
  overlay.querySelector('.close-model-info').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}
```

- [ ] **Step 3: Wire up info button in settings model selects**

Find each provider's model select in `loadSettings` (around line 1488-1508) and add an info button next to each `<select id="model-...">`. Insert after the existing model-value restoration block (after line 1508):

```js
// Add model info buttons
document.querySelectorAll('.provider-body select[id^="model-"]').forEach(sel => {
  const parent = sel.parentNode;
  if (parent.querySelector('.btn-model-info')) return;
  const btn = document.createElement('button');
  btn.className = 'btn-model-info';
  btn.textContent = '\u24D8';
  btn.title = 'Model info';
  btn.addEventListener('click', () => {
    const providerId = sel.id.replace('model-', '');
    showModelInfo(providerId, sel.value);
  });
  parent.insertBefore(btn, sel.nextSibling);
});
```

- [ ] **Step 4: Add CSS for model info modal**

Add to `style.css` (after line 511, or near existing modal styles):

```css
.model-info-modal { max-width: 420px; }
.model-info-grid { display: flex; flex-direction: column; gap: 0.5rem; margin: 1rem 0; }
.info-row { display: flex; justify-content: space-between; align-items: center; padding: 0.3rem 0; border-bottom: 1px solid var(--border); }
.info-label { color: var(--text2); font-size: 0.85rem; }
.info-value { font-weight: 500; }
.caps-list { display: flex; flex-wrap: wrap; gap: 0.3rem; justify-content: flex-end; }
.cap-badge { font-size: 0.7rem; padding: 0.15rem 0.4rem; border-radius: 3px; white-space: nowrap; }
.cap-yes { background: rgba(34,197,94,0.2); color: #22c55e; }
.cap-no { background: rgba(239,68,68,0.15); color: #ef4444; }
.btn-model-info { background: none; border: none; color: var(--text3); cursor: pointer; font-size: 1rem; padding: 0.2rem 0.4rem; margin-left: 0.3rem; }
.btn-model-info:hover { color: var(--text); }
```

- [ ] **Step 5: Wire info button for current model in header**

In the provider dropdown change handler (around line 206 where `#provider-select` change is handled), add a model info button next to the active model display in the titlebar:

```js
// Add to the existing provider-select change handler
const infoBtn = document.getElementById('btn-model-info-header');
if (infoBtn) {
  infoBtn.style.display = '';
  infoBtn.onclick = () => showModelInfo(providerId, model);
}
```

And in `index.html`, add the button next to the provider select (around line 209):
```html
<button id="btn-model-info-header" class="btn-model-info" title="Model Info" style="display:none;">&#x24D8;</button>
```

---

### Task 2: Free/API-Key Indicator

**Files:**
- Modify: `App/renderer/script.js` — add free/key icon logic
- Modify: `App/renderer/style.css` — icon styles
- Modify: `App/renderer/index.html` — placeholder span in model selects

**Interfaces:**
- Consumes: `MODEL_META` from Task 1
- Produces: free/key indicator rendered in each provider body + provider-select dropdown

- [ ] **Step 1: Add indicator to model options**

Find each `<select id="model-...">` in `loadSettings` and, after setting the value, append a free/key indicator icon. Add this after the model info button wiring (from Task 1 Step 3):

```js
// Add free/API indicator next to model selects
document.querySelectorAll('.provider-body select[id^="model-"]').forEach(sel => {
  const parent = sel.parentNode;
  if (parent.querySelector('.model-free-badge')) return;
  const badge = document.createElement('span');
  badge.className = 'model-free-badge';
  parent.insertBefore(badge, sel.nextSibling);
  const updateBadge = () => {
    const meta = MODEL_META[sel.value];
    if (meta && meta.free) { badge.textContent = '\u2601 Free'; badge.className = 'model-free-badge free'; }
    else { badge.textContent = '\uD83D\uDD11 Key'; badge.className = 'model-free-badge key'; }
  };
  updateBadge();
  sel.addEventListener('change', updateBadge);
});
```

- [ ] **Step 2: Add CSS**

```css
.model-free-badge { font-size: 0.7rem; margin-left: 0.4rem; padding: 0.1rem 0.3rem; border-radius: 3px; }
.model-free-badge.free { color: #22c55e; }
.model-free-badge.key { color: var(--text3); }
```

- [ ] **Step 3: Add indicator to provider-select dropdown**

In the provider-select change handler, add a badge next to the selected provider name. Find the element `#provider-select` and add a sibling span after it in `index.html` (around line 206-215):

```html
<select id="provider-select">
  <option value="openai">OpenAI 🔑</option>
  ...
</select>
<span id="provider-free-badge" class="model-free-badge"></span>
```

In `script.js` in the provider-select change handler, add:

```js
const modelSelect = document.getElementById('model-' + providerId);
const badge = document.getElementById('provider-free-badge');
if (modelSelect && badge) {
  const meta = MODEL_META[modelSelect.value];
  badge.textContent = meta && meta.free ? '\u2601 Free' : '\uD83D\uDD11 Key';
  badge.className = 'model-free-badge ' + (meta && meta.free ? 'free' : 'key');
}
```

---

### Task 3: AI Activity Display

**Files:**
- Modify: `App/renderer/script.js` — make `setActivity` persistent, add more trigger points
- Modify: `App/renderer/style.css` — activity bar styles

**Interfaces:**
- Consumes: chat message DOM, tool execution pipeline (around line 3680)
- Produces: persistent activity bar that updates during AI processing

- [ ] **Step 1: Refactor `setActivity` to be persistent**

Replace the existing `setActivity` function (around line 3682-3691) with a version that doesn't auto-hide:

```js
function setActivity(text) {
  if (!activityEl) {
    activityEl = document.createElement('div');
    activityEl.className = 'chat-activity';
    const container = document.getElementById('chat-messages');
    container.appendChild(activityEl);
  }
  activityEl.textContent = text;
}

function clearActivity() {
  if (activityEl) {
    activityEl.remove();
    activityEl = null;
  }
}
```

- [ ] **Step 2: Add activity triggers at key points**

In the tool execution switch (around line 3050-3170), add `setActivity()` calls before/after each operation:

Before `case 'read_file'` (around line 3080):
```js
setActivity('\uD83D\uDCD6 Reading ' + (args.path || ''));
```

Before `case 'write_file'` (around line 3100):
```js
setActivity('\u270F\uFE0F Editing ' + (args.path || ''));
```

Before `case 'delete_file'` (around line 3140):
```js
setActivity('\uD83D\uDDD1\uFE0F Deleting ' + (args.path || ''));
```

Before `case 'exec_command'` (around line 3159):
```js
setActivity('\uD83D\uDCBB SHELL: ' + (args.command || '').slice(0, 60));
```

Before `case 'search_files'` (around line 3154):
```js
setActivity('\uD83D\uDD0D Searching: ' + (args.query || ''));
```

During 429 backoff (around line 3752-3758):
```js
setActivity('\u23F3 Waiting (Rate Limit) Retry in ' + (delay / 1000) + 's');
```

After tool execution completes, add after each `return` statement:
```js
clearActivity();
```
(Add this at the end of each tool case before `return`, or add a finally-like cleanup.)

- [ ] **Step 3: Clear activity on completion/error**

In the main request handler, after the response is complete (around line 3880 where stopAnim is called), add:
```js
clearActivity();
```

In the error handler (around line 3940), add:
```js
clearActivity();
```

- [ ] **Step 4: Add CSS for activity bar**

```css
.chat-activity {
  color: var(--text3);
  font-size: 0.75rem;
  padding: 0.2rem 0.5rem;
  margin: 0.2rem 0;
  border-left: 2px solid var(--text3);
  font-family: monospace;
}
```

---

### Task 4: AI-Generated Confirmation Descriptions

**Files:**
- Modify: `App/renderer/script.js` — show `description` args in permission prompts
- Modify: `App/renderer/style.css` — description styling

**Interfaces:**
- Consumes: `args.description` from tool definitions (already exists in tool schemas)
- Produces: description shown in permission prompt UI

- [ ] **Step 1: Show description in permission prompt**

In `showPermissionPrompt` (around line 1070), the `desc` variable is already included but uses `args.description`. Verify it works. The current code at line 1078 already reads:

```js
const desc = args.description ? '<p style="color:var(--text2);font-size:0.85rem;margin-top:0.5rem;">' + escapeHtml(args.description) + '</p>' : '';
```

This is already functional. The key is that the tool definitions in `getActiveTools()` (line 157-161) already have `description` parameters for `write_file`, `delete_file`, and `exec_command`. The AI will be prompted to provide these by the system prompt.

Add a prominent label in the permission prompt to make the description stand out:

Replace the existing desc line (1078) with:
```js
const desc = args.description ? '<div class="perm-desc"><strong>Summary:</strong> ' + escapeHtml(args.description) + '</div>' : '';
```

- [ ] **Step 2: Add CSS**

```css
.perm-desc { background: var(--bg3); padding: 0.5rem; border-radius: 4px; margin: 0.5rem 0; font-size: 0.85rem; border-left: 3px solid var(--accent); }
.perm-desc strong { color: var(--text2); }
```

- [ ] **Step 3: Ensure system prompt encourages descriptions**

In `buildSystemPrompt` (around line 1310), the tool descriptions already include `description` param. Verify the system prompt mentions writing summaries. The rules section at line 1340+ should already encourage this. Add if missing:

At line 1349 (or nearby rules section), add a rule:
```
10. When using write_file, delete_file, rename_file, or exec_command, always provide a brief "description" parameter summarizing the action in 2-5 words.
```

---
