# Ollama Model Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Erweiterung des bestehenden Ollama Model Managers um Delete, Info, Live-Status und Search.

**Architecture:** Bestehende Ollama-API-Calls erweitern; alles in `App/renderer/script.js` + `style.css`.

**Tech Stack:** Electron, vanilla JS, Ollama REST API (`/api/tags`, `/api/ps`, `/api/show`, `/api/delete`, `/api/pull`)

## Global Constraints
- Kein Build-Step, keine externen Dependencies
- Alle Änderungen in `App/renderer/script.js` und `App/renderer/style.css`
- Bestehende Pattern folgen (fetchWithTimeout, Modal-Overlay, Promise-basiert)

---

### Task 1: Delete Model Functionality

**Files:**
- Modify: `App/renderer/script.js` (nach `showOllamaDownloadModal`)

**Interfaces:**
- Consumes: `showOllamaDownloadModal()` already exists at line ~4809
- Produces: `OllamaModelActions` div with delete button per model

- [ ] **Step 1: Add delete button to model list items**

In `btn-ollama-models` click handler, change the model list rendering to include a delete button:

```
// Replace line 4793-4794
list.innerHTML = models.map(m =>
  '<div class="ollama-model-item" data-name="' + escapeHtml(m.name) + '">' +
    '<span class="ollama-model-name">' + escapeHtml(m.name) + '</span>' +
    '<button class="ollama-model-delete" data-name="' + escapeHtml(m.name) + '" title="Delete model">🗑</button>' +
  '</div>'
).join('') +
'<div class="ollama-download-item">+ Download Model</div>';
```

- [ ] **Step 2: Add click handler for delete buttons**

Inside the same listener, after `querySelectorAll('.ollama-model-item')` loop, add:

```
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
```

- [ ] **Step 3: Add CSS for delete button**

In `style.css`:
```
.ollama-model-item { display: flex; align-items: center; justify-content: space-between; padding: 0.3rem 0.5rem; cursor: pointer; border-radius: 4px; }
.ollama-model-item:hover { background: var(--hover); }
.ollama-model-name { flex: 1; }
.ollama-model-delete { background: none; border: none; cursor: pointer; font-size: 0.8rem; padding: 0.1rem 0.3rem; opacity: 0.5; }
.ollama-model-delete:hover { opacity: 1; }
```

- [ ] **Step 4: Verify syntax**

Run: `node -e "new Function(require('fs').readFileSync('App/renderer/script.js','utf8'))" && echo OK`

---

### Task 2: Model Info on Click

**Files:**
- Modify: `App/renderer/script.js` (innerhalb des `btn-ollama-models` listeners)
- Modify: `App/renderer/style.css`

- [ ] **Step 1: Add model info fetch on item click**

Replace the existing `.ollama-model-item` click handler:

```
list.querySelectorAll('.ollama-model-item').forEach(item => {
  item.addEventListener('click', async () => {
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
        name + ' — ' + size + ' — modified ' + modified +
        (info.details ? ' — ' + info.details.parameter_size + ' params' : ''),
        '🤖');
    } catch {}
  });
});
```

- [ ] **Step 2: Verify syntax**

Run: `node -e "new Function(require('fs').readFileSync('App/renderer/script.js','utf8'))" && echo OK`

---

### Task 3: Ollama Live Status

**Files:**
- Modify: `App/renderer/script.js` (nach showOllamaDownloadModal)
- Modify: `App/renderer/index.html` (neben model-ollama input)
- Modify: `App/renderer/style.css`

- [ ] **Step 1: Add status indicator next to Ollama model input**

In `index.html` nach dem `btn-ollama-models` Button (Zeile ~550):
```
<span id="ollama-status" class="ollama-status" title="Ollama status">●</span>
```

- [ ] **Step 2: Add CSS for status indicator**

In `style.css`:
```
.ollama-status { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-left: 0.3rem; }
.ollama-status.online { background: #22c55e; box-shadow: 0 0 4px #22c55e; }
.ollama-status.offline { background: #ef4444; }
.ollama-status.checking { background: #facc15; animation: pulse 1s infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
```

- [ ] **Step 3: Add status check function**

In `script.js`:
```
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
// Call on load and periodically
checkOllamaStatus();
setInterval(checkOllamaStatus, 30000);
```

- [ ] **Step 4: Run status check when Ollama URL changes**

Add event listener:
```
document.getElementById('url-ollama')?.addEventListener('change', checkOllamaStatus);
```

- [ ] **Step 5: Verify syntax**

Run: `node -e "new Function(require('fs').readFileSync('App/renderer/script.js','utf8'))" && echo OK`

---

### Task 4: Search in Download Modal

**Files:**
- Modify: `App/renderer/script.js` (in `showOllamaDownloadModal`)
- Modify: `App/renderer/style.css`

- [ ] **Step 1: Add search field to download modal**

In `showOllamaDownloadModal()`, vor den Quick-Select-Buttons einfügen:
```
'<div style="position:relative;margin-bottom:0.5rem;">' +
  '<input type="text" id="ollama-dl-search" placeholder="Search models..." style="width:100%;padding:0.4rem;border:1px solid var(--border);border-radius:4px;background:var(--bg3);color:var(--text);" />' +
  '<div id="ollama-dl-search-results" class="ollama-search-results hidden"></div>' +
'</div>' +
```

- [ ] **Step 2: Add search results container CSS**

In `style.css`:
```
.ollama-search-results { position: absolute; top: 100%; left: 0; right: 0; max-height: 200px; overflow-y: auto; background: var(--bg2); border: 1px solid var(--border); border-radius: 4px; z-index: 10; }
.ollama-search-item { padding: 0.3rem 0.5rem; cursor: pointer; font-size: 0.85rem; }
.ollama-search-item:hover { background: var(--hover); }
```

- [ ] **Step 3: Add search handler**

Nach den Quick-Select-Buttons in `showOllamaDownloadModal`:

```
const searchInput = document.getElementById('ollama-dl-search');
const searchResults = document.getElementById('ollama-dl-search-results');
if (searchInput) {
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim().toLowerCase();
    if (!q) { searchResults.classList.add('hidden'); return; }
    searchTimer = setTimeout(async () => {
      try {
        const r = await fetch('https://ollama.com/library?q=' + encodeURIComponent(q));
        // Fallback: filter popular list client-side
        const known = ['llama3.2','llama3.1','qwen2.5-coder','mistral','codestral','deepseek-coder-v2','phi3','gemma2','nomic-embed-text','llava','mixtral','command-r','dolphin-llama3','starling-lm'];
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
        }
      } catch {}
    }, 300);
  });
}
```

- [ ] **Step 4: Verify syntax**

Run: `node -e "new Function(require('fs').readFileSync('App/renderer/script.js','utf8'))" && echo OK`
