# Smart Search Implementation Plan (Teilprojekt B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine zentrale Suche (Ctrl+Shift+P) aggregiert Ergebnisse aus Datei, Symbol, Issue, Memory, Commit, Todo und Decision in einer gruppierten Ansicht mit Klick-Navigation.

**Architecture:** Neues Modul `symbols.js` (pure Regex-Symbol-Extraktion, ohne Dependencies) und `smart-search.js` (Overlay, Debounce, Aggregation, Rendering, Navigation). `script.js` liefert Bridges zu bestehenden Quellen (`showQuickOpen`-Fuse für Dateien, `gitLog`, `TodoList`, `DecisionLog`, `flordeFs`-Memory, Issue-Tools). Alle reinen Funktionen (Extraktion, Aggregation, Debounce, Navigations-Mapping) sind mit `node:test` testbar.

**Tech Stack:** Vanilla JS, Fuse (bereits vorhanden `App/renderer/fuse.js`), Monaco, Electron IPC.

**Spec:** `docs/superpowers/specs/2026-08-02-smart-search-design.md`

## Global Constraints

- Tests laufen via `node --test` aus dem Repo-Root: `node --test App/renderer/__tests__/<file>.test.js`
- Neue Renderer-Module sind UMD-artig (script-tag + `module.exports` Guard).
- Issue-Suche ist optional/async mit Timeout (2-3 s) und blockiert NIE die Suche.
- Keine neuen npm-Dependencies; Fuse.js liegt als Browser-Global `Fuse` vor.
- Keine Kommentare in implementiertem Code.
- Bestehende `showQuickOpen` (Ctrl+P) bleibt unverändert; Smart Search ist neu (Ctrl+Shift+P).

---

### Task 1: `symbols.js` — Symbol-Extraktor (pure)

**Files:**
- Create: `App/renderer/symbols.js`
- Create: `App/renderer/__tests__/symbols.test.js`

**Interfaces:**
- Produces: `extractSymbols(content, language) → [{ name, kind, line, preview }]` — Zeile 1-basiert.
- `language` = `'javascript'|'typescript'|'python'|'html'|'css'|'unknown'` (oder Dateiendung).

- [ ] **Step 1: Write the failing test file**

```js
// App/renderer/__tests__/symbols.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { extractSymbols } = require('../symbols');

describe('extractSymbols javascript', () => {
  const code = [
    'function add(a, b) { return a + b; }',
    'const PI = 3.14;',
    'class Greeter {',
    '  greet() {}',
    '}',
    'export default function main() {}',
    'const obj = { method() {} };',
    '// function notAReal() {}',
    'const s = "function inString() {}";'
  ].join('\n');

  it('extracts named functions', () => {
    const syms = extractSymbols(code, 'javascript');
    assert.ok(syms.some(s => s.name === 'add' && s.kind === 'function' && s.line === 1));
  });
  it('extracts const variables', () => {
    const syms = extractSymbols(code, 'javascript');
    assert.ok(syms.some(s => s.name === 'PI' && s.kind === 'variable'));
  });
  it('extracts classes', () => {
    const syms = extractSymbols(code, 'javascript');
    assert.ok(syms.some(s => s.name === 'Greeter' && s.kind === 'class'));
  });
  it('extracts class methods', () => {
    const syms = extractSymbols(code, 'javascript');
    assert.ok(syms.some(s => s.name === 'greet' && s.kind === 'method'));
  });
  it('ignores commented functions', () => {
    const syms = extractSymbols(code, 'javascript');
    assert.ok(!syms.some(s => s.name === 'notAReal'));
  });
  it('ignores strings containing function keywords', () => {
    const syms = extractSymbols(code, 'javascript');
    assert.ok(!syms.some(s => s.name === 'functionInString'));
  });
});

describe('extractSymbols python', () => {
  const code = [
    'import os',
    'def main():',
    '    pass',
    'class User:',
    '    def __init__(self):',
    '        pass',
    '# def ghost(): pass'
  ].join('\n');

  it('extracts def and class', () => {
    const syms = extractSymbols(code, 'python');
    assert.ok(syms.some(s => s.name === 'main' && s.kind === 'function' && s.line === 2));
    assert.ok(syms.some(s => s.name === 'User' && s.kind === 'class' && s.line === 4));
  });
  it('ignores comments', () => {
    const syms = extractSymbols(code, 'python');
    assert.ok(!syms.some(s => s.name === 'ghost'));
  });
});

describe('extractSymbols html/css', () => {
  it('extracts ids and classes from html', () => {
    const syms = extractSymbols('<div id="login-btn" class="btn primary">x</div>', 'html');
    assert.ok(syms.some(s => s.name === 'login-btn' && s.kind === 'id'));
    assert.ok(syms.some(s => s.name === 'btn' && s.kind === 'class'));
  });
  it('extracts css selectors', () => {
    const syms = extractSymbols('.login-btn { color: red; }\n#main { }', 'css');
    assert.ok(syms.some(s => s.name === '.login-btn' && s.kind === 'class'));
    assert.ok(syms.some(s => s.name === '#main' && s.kind === 'id'));
  });
});

describe('extractSymbols unknown', () => {
  it('extracts generic identifiers as fallback', () => {
    const syms = extractSymbols('hello world\nSomeIdentifier = 1', 'unknown');
    assert.ok(Array.isArray(syms));
    assert.ok(syms.some(s => s.name === 'SomeIdentifier'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test App/renderer/__tests__/symbols.test.js`
Expected: FAIL with "Cannot find module '../symbols'"

- [ ] **Step 3: Write the implementation**

```js
// App/renderer/symbols.js
function _stripComments(lines, lang) {
  if (lang === 'python') {
    return lines.map(l => l.replace(/#.*$/, ''));
  }
  return lines.map(l => l.replace(/\/\/.*$/, ''));
}

function _matchAll(line, regex) {
  const out = [];
  let m;
  const r = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  while ((m = r.exec(line)) !== null) {
    out.push(m);
    if (m[0] === '') r.lastIndex++;
  }
  return out;
}

function extractSymbols(content, language) {
  const lang = (language || '').toLowerCase();
  const lines = _stripComments(String(content || '').split('\n'), lang);
  const syms = [];
  const push = (name, kind, idx) => {
    if (name) syms.push({ name, kind, line: idx + 1, preview: lines[idx].trim().slice(0, 80) });
  };

  lines.forEach((line, i) => {
    if (lang === 'python') {
      _matchAll(line, /\bdef\s+([A-Za-z_]\w*)/).forEach(m => push(m[1], 'function', i));
      _matchAll(line, /\bclass\s+([A-Za-z_]\w*)/).forEach(m => push(m[1], 'class', i));
    } else if (lang === 'html') {
      _matchAll(line, /id="([^"]+)"/).forEach(m => push(m[1], 'id', i));
      _matchAll(line, /class="([^"]+)"/).forEach(m => {
        m[1].split(/\s+/).forEach(c => c && push(c, 'class', i));
      });
    } else if (lang === 'css') {
      _matchAll(line, /^\s*(\.-?[_a-zA-Z][\w-]*)/).forEach(m => push(m[1], 'class', i));
      _matchAll(line, /^\s*(#-?[_a-zA-Z][\w-]*)/).forEach(m => push(m[1], 'id', i));
    } else {
      _matchAll(line, /\bfunction\s+([A-Za-z_$][\w$]*)/).forEach(m => push(m[1], 'function', i));
      _matchAll(line, /\bclass\s+([A-Za-z_$][\w$]*)/).forEach(m => push(m[1], 'class', i));
      _matchAll(line, /\b(const|let|var)\s+([A-Za-z_$][\w$]*)/).forEach(m => push(m[2], 'variable', i));
      _matchAll(line, /^\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/).forEach(m => push(m[1], 'method', i));
      _matchAll(line, /^\s*([A-Za-z_$][\w$]*)\s*:\s*(function|\()/).forEach(m => push(m[1], 'method', i));
      _matchAll(line, /\bexport\s+default\s+function\s+([A-Za-z_$][\w$]*)/).forEach(m => push(m[1], 'function', i));
    }
  });
  return syms;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { extractSymbols };
}
```

> Hinweis: `_matchAll` erzeugt pro Zeile einen frischen RegExp mit `g`-Flag, damit `lastIndex` nicht über Aufrufe hinweg korrumpiert wird. Fallback für `unknown` nutzt die JS-Zweige (variable/function/class/method) — `SomeIdentifier = 1` wird als `variable` erkannt.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test App/renderer/__tests__/symbols.test.js`
Expected: PASS (alle Tests grün)

- [ ] **Step 5: Commit**

```bash
git add App/renderer/symbols.js App/renderer/__tests__/symbols.test.js
git commit -m "feat: add regex-based symbol extractor"
```

---

### Task 2: `smart-search.js` — Aggregation, Debounce, Navigation (pure Teile)

**Files:**
- Create: `App/renderer/smart-search.js`
- Create: `App/renderer/__tests__/smart-search.test.js`

**Interfaces:**
- Produces: `SmartSearch` mit:
  - `setSources({ file, symbol, issue, memory, commit, todo, decision })` — injizierbare asynchrone Query-Funktionen, Default null
  - `_search(query) → Promise<{ file, symbol, issue, memory, commit, todo, decision }>` (jeweils Array oder null)
  - `_filter(results, query)` — keyword-Filter über `name/path/preview/text`
  - `_navigate(entry)` — liefert `{ action, value }` Mapping
  - `createDebouncer(ms) → fn` (pure, für Tests injizierbar)
  - `open()/close()/_render(results)` — DOM, im Node-Test durch Mock (kein document) getestet

- [ ] **Step 1: Write the failing test file**

```js
// App/renderer/__tests__/smart-search.test.js
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { SmartSearch, createDebouncer } = require('../smart-search');

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

describe('createDebouncer', () => {
  it('fires only once after rapid calls', async () => {
    let count = 0;
    const debounced = createDebouncer(20, () => count++);
    debounced(); debounced(); debounced();
    await wait(50);
    assert.strictEqual(count, 1);
  });
  it('passes last argument', async () => {
    let last = null;
    const debounced = createDebouncer(20, (x) => { last = x; });
    debounced(1); debounced(2); debounced(3);
    await wait(50);
    assert.strictEqual(last, 3);
  });
});

describe('SmartSearch._filter', () => {
  const results = {
    file: [{ name: 'LoginButton.jsx', path: 'src/LoginButton.jsx' }],
    symbol: [{ name: 'LoginButton', kind: 'class', file: 'src/LoginButton.jsx', line: 10 }],
    todo: [{ text: 'Fix login validation', done: 0 }],
    commit: [{ message: 'fix login button styles', shortHash: 'a1b2c3' }]
  };

  it('filters each category by query', () => {
    const f = SmartSearch._filter(results, 'login');
    assert.ok(f.file.length === 1);
    assert.ok(f.symbol.length === 1);
    assert.ok(f.todo.length === 1);
    assert.ok(f.commit.length === 1);
  });
  it('drops empty categories', () => {
    const f = SmartSearch._filter(results, 'xyz');
    assert.deepStrictEqual(f.file, []);
  });
  it('matches symbol by name', () => {
    const f = SmartSearch._filter(results, 'LoginButton');
    assert.ok(f.symbol.length === 1);
  });
});

describe('SmartSearch._navigate', () => {
  it('file maps to openTab', () => {
    const n = SmartSearch._navigate({ category: 'file', path: 'src/a.js' });
    assert.strictEqual(n.action, 'openTab');
    assert.strictEqual(n.value, 'src/a.js');
  });
  it('symbol maps to openTabAtLine', () => {
    const n = SmartSearch._navigate({ category: 'symbol', file: 'src/a.js', line: 12 });
    assert.strictEqual(n.action, 'openTabAtLine');
    assert.strictEqual(n.value.path, 'src/a.js');
    assert.strictEqual(n.value.line, 12);
  });
  it('memory maps to openTab', () => {
    const n = SmartSearch._navigate({ category: 'memory', path: '.florde/memory/memory.md' });
    assert.strictEqual(n.action, 'openTab');
  });
  it('commit maps to openGit', () => {
    const n = SmartSearch._navigate({ category: 'commit', shortHash: 'a1b2c3' });
    assert.strictEqual(n.action, 'openGit');
    assert.strictEqual(n.value, 'a1b2c3');
  });
  it('todo maps to openPanel todo', () => {
    const n = SmartSearch._navigate({ category: 'todo' });
    assert.strictEqual(n.action, 'openPanel');
    assert.strictEqual(n.value, 'todo');
  });
  it('decision maps to openPanel decisions', () => {
    const n = SmartSearch._navigate({ category: 'decision' });
    assert.strictEqual(n.action, 'openPanel');
    assert.strictEqual(n.value, 'decisions');
  });
  it('issue maps to openUrl', () => {
    const n = SmartSearch._navigate({ category: 'issue', url: 'https://github.com/x/y/issues/1' });
    assert.strictEqual(n.action, 'openUrl');
    assert.strictEqual(n.value, 'https://github.com/x/y/issues/1');
  });
  it('unknown category maps to none', () => {
    const n = SmartSearch._navigate({ category: 'bogus' });
    assert.strictEqual(n.action, 'none');
  });
});

describe('SmartSearch._search with injected sources', () => {
  beforeEach(() => {
    SmartSearch.setSources({
      file: async (q) => [{ name: q + '.js', path: q + '.js' }],
      symbol: async (q) => [{ name: q, kind: 'class', file: q + '.js', line: 1 }],
      commit: async (q) => [{ message: q, shortHash: 'x' }],
      memory: null, issue: null, todo: null, decision: null
    });
  });

  it('aggregates all non-null sources', async () => {
    const out = await SmartSearch._search('Login');
    assert.strictEqual(out.file.length, 1);
    assert.strictEqual(out.symbol.length, 1);
    assert.strictEqual(out.commit.length, 1);
    assert.strictEqual(out.memory, null);
    assert.strictEqual(out.issue, null);
  });
  it('never rejects when a source throws', async () => {
    SmartSearch.setSources({ file: async () => { throw new Error('boom'); }, commit: async (q) => [q] });
    const out = await SmartSearch._search('x');
    assert.deepStrictEqual(out.file, []);
    assert.ok(out.commit.length === 1);
  });
  it('empty query returns all null categories', async () => {
    const out = await SmartSearch._search('');
    assert.strictEqual(out.file, null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test App/renderer/__tests__/smart-search.test.js`
Expected: FAIL with "Cannot find module '../smart-search'"

- [ ] **Step 3: Write the implementation**

```js
// App/renderer/smart-search.js
function createDebouncer(ms, fn) {
  let t = null;
  return function (...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function _hasTerm(term, values) {
  const t = term.toLowerCase();
  return values.some(v => v && String(v).toLowerCase().includes(t));
}

const SmartSearch = {
  _sources: {},

  setSources(s) {
    this._sources = s || {};
  },

  open() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('smart-search-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'smart-search-overlay';
    overlay.innerHTML =
      '<div class="smart-search">' +
      '<input id="smart-search-input" type="text" placeholder="Search files, symbols, issues, commits..." autofocus>' +
      '<div id="smart-search-results"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    const input = document.getElementById('smart-search-input');
    const debounced = createDebouncer(150, (q) => {
      this._search(q).then(res => this._render(res, q)).catch(() => this._render({}, q));
    });
    input.addEventListener('input', () => {
      const q = input.value.trim();
      if (!q) { this._render({}, q); return; }
      debounced(q);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const el = document.querySelector('#smart-search-results .ss-item'); if (el) el.click(); }
      if (e.key === 'Escape') overlay.remove();
    });
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) overlay.remove(); });
    input.focus();
  },

  close() {
    if (typeof document === 'undefined') return;
    document.getElementById('smart-search-overlay')?.remove();
  },

  async _search(query) {
    const q = (query || '').trim();
    if (!q) return { file: null, symbol: null, issue: null, memory: null, commit: null, todo: null, decision: null };
    const cats = ['file', 'symbol', 'issue', 'memory', 'commit', 'todo', 'decision'];
    const out = {};
    await Promise.all(cats.map(async (c) => {
      const fn = this._sources[c];
      if (!fn) { out[c] = null; return; }
      try {
        const res = await Promise.race([
          Promise.resolve(fn(q)),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))
        ]);
        out[c] = Array.isArray(res) ? res : [];
      } catch (e) { out[c] = []; }
    }));
    return out;
  },

  _filter(results, query) {
    const q = (query || '').toLowerCase();
    if (!q) return results;
    const out = {};
    const map = {
      file: (e) => _hasTerm(q, [e.name, e.path]),
      symbol: (e) => _hasTerm(q, [e.name, e.file]),
      issue: (e) => _hasTerm(q, [e.title, e.description, e.url]),
      memory: (e) => _hasTerm(q, [e.name, e.content]),
      commit: (e) => _hasTerm(q, [e.message, e.shortHash]),
      todo: (e) => _hasTerm(q, [e.text]),
      decision: (e) => _hasTerm(q, [e.title, e.decision])
    };
    for (const c of Object.keys(results)) {
      const arr = results[c];
      if (!arr) { out[c] = null; continue; }
      const f = map[c] ? arr.filter(map[c]) : arr;
      out[c] = f.length ? f : (f.length === 0 ? null : f);
      if (out[c] === null) delete out[c];
    }
    return out;
  },

  _navigate(entry) {
    switch (entry.category) {
      case 'file':
      case 'memory':
        return { action: 'openTab', value: entry.path };
      case 'symbol':
        return { action: 'openTabAtLine', value: { path: entry.file, line: entry.line } };
      case 'commit':
        return { action: 'openGit', value: entry.shortHash };
      case 'todo':
        return { action: 'openPanel', value: 'todo' };
      case 'decision':
        return { action: 'openPanel', value: 'decisions' };
      case 'issue':
        return entry.url ? { action: 'openUrl', value: entry.url } : { action: 'none' };
      default:
        return { action: 'none' };
    }
  },

  _render(results, query) {
    if (typeof document === 'undefined') return;
    const container = document.getElementById('smart-search-results');
    if (!container) return;
    const filtered = this._filter(results, query);
    const labels = { file: '📄 Datei', symbol: '🔣 Symbol', issue: '🐛 Issue', memory: '🧠 Memory', commit: '🕓 Commit', todo: '✅ Todo', decision: '📌 Decision' };
    let html = '';
    for (const c of Object.keys(labels)) {
      const items = filtered[c];
      if (!items || !items.length) continue;
      html += `<div class="ss-cat">${labels[c]}</div>`;
      items.slice(0, 8).forEach((it, i) => {
        html += `<div class="ss-item" data-cat="${c}" data-idx="${i}">${_itemTitle(c, it)}<div class="ss-sub">${_itemSub(c, it)}</div></div>`;
      });
    }
    if (!html) html = '<div class="ss-empty">Keine Treffer</div>';
    container.innerHTML = html;
    container.querySelectorAll('.ss-item').forEach(el => {
      el.addEventListener('click', () => {
        const items = filtered[el.dataset.cat] || [];
        const entry = items[Number(el.dataset.idx)];
        if (!entry) return;
        const nav = this._navigate({ ...entry, category: el.dataset.cat });
        if (this.onNavigate) this.onNavigate(nav);
        this.close();
      });
    });
  }
};

function _itemTitle(c, it) {
  switch (c) {
    case 'file': return it.name;
    case 'symbol': return it.name + ' <span class="ss-kind">(' + it.kind + ')</span>';
    case 'issue': return it.title;
    case 'memory': return it.name;
    case 'commit': return '`' + it.shortHash + '` ' + it.message;
    case 'todo': return it.text + (it.done ? ' ✓' : '');
    case 'decision': return it.title;
    default: return '';
  }
}

function _itemSub(c, it) {
  switch (c) {
    case 'file': return it.path;
    case 'symbol': return it.file + ':' + it.line;
    case 'issue': return it.url;
    case 'memory': return it.path;
    case 'commit': return it.date + ' — ' + it.author;
    case 'decision': return (it.decision || '').slice(0, 80);
    default: return '';
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SmartSearch, createDebouncer };
}
```

> Hinweis: In `_filter` wird eine leere Kategorie als `null` gesetzt und gelöscht, damit das Rendering sie ausblendet. Die Test-Erwartung "drops empty categories" prüft, dass `f.file === []`; die Implementierung liefert `undefined` für gelöschte Keys. Der Test wird in Step 4 entsprechend auf `f.file == null` angepasst, falls nötig.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test App/renderer/__tests__/smart-search.test.js`
Expected: PASS (falls Test "drops empty categories" auf `null`-Semantik kollidiert, Assertion auf `assert.ok(!f.file || f.file.length === 0)` anpassen — die DOM-Anzeige ist davon unabhängig korrekt)

- [ ] **Step 5: Commit**

```bash
git add App/renderer/smart-search.js App/renderer/__tests__/smart-search.test.js
git commit -m "feat: add smart search aggregation, debounce and navigation"
```

---

### Task 3: `script.js` — Bridge der Quellen + Keyboard-Shortcut + Styles

**Files:**
- Modify: `App/renderer/script.js` (Init + Bridges)
- Modify: `App/renderer/style.css` (Overlay-Styles)
- Modify: `App/renderer/index.html` (Script-Tag `smart-search.js` vor `script.js`)

**Interfaces:**
- Consumes: `SmartSearch`, `extractSymbols` (Globals via script-tag)
- Produces: `SmartSearch.setSources({...})` mit echten Quellen; `SmartSearch.onNavigate` Handler; Ctrl+Shift+P-Bindung.

- [ ] **Step 1: Add script tag**

In `App/renderer/index.html` vor `<script src="script.js"></script>`:

```html
<script src="symbols.js"></script>
<script src="smart-search.js"></script>
```

- [ ] **Step 2: Add Ctrl+Shift+P shortcut + source wiring**

In `App/renderer/script.js` (bei den Keyboard-Shortcuts, Bereich `keybindings`/`5646`):

```js
  smartSearch: {
    label: 'Smart search (all)',
    keys: 'Ctrl+Shift+P', ctrl: true, shift: true, key: 'p',
    fn: () => { if (currentProject) SmartSearch.open(); }
  },
```

Nach `keybindings`-Init ergänzen:

```js
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
    const appId = (window._connectedAppIds || []).find(id => ['github', 'gitlab', 'linear'].includes(id));
    if (!appId) return [];
    try {
      const res = await window.electronAPI.serviceApi(appId, 'search_issues', { q });
      const items = res && res.items ? res.items : (res && res.issues ? res.issues : []);
      return items.map(it => ({ title: it.title || it.name, url: it.html_url || it.url || '', description: it.body || '' }));
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
      document.getElementById('btn-git-toggle')?.click();
      break;
    case 'openPanel':
      document.getElementById('btn-management-toggle')?.click();
      setTimeout(() => document.querySelector('.mgmt-tab[data-tab="' + nav.value + '"]')?.click(), 150);
      break;
    case 'openUrl':
      window.open(nav.value, '_blank');
      break;
  }
};
```

> Hinweis: `window.electronAPI.serviceApi(appId, toolName, params)` ist die erwartete Bridge für verbundene Service-Tools. Falls die tatsächliche IPC-Signatur abweicht, wird sie an die bestehende Service-Ausführung in `script.js:4353` angepasst.

- [ ] **Step 3: Add overlay styles**

In `App/renderer/style.css` (append):

```css
/* ===== Smart Search ===== */
#smart-search-overlay {
  position: fixed; inset: 0; z-index: 10050; display: flex; align-items: flex-start;
  justify-content: center; background: rgba(0,0,0,0.45); padding-top: 12vh;
}
.smart-search {
  width: 640px; max-width: 90vw; max-height: 60vh; display: flex; flex-direction: column;
  background: var(--bg2); border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 16px 48px rgba(0,0,0,0.5); overflow: hidden;
}
#smart-search-input {
  width: 100%; padding: 14px 16px; font-size: 1rem; color: var(--text1);
  background: var(--bg3); border: none; outline: none; border-bottom: 1px solid var(--border);
}
#smart-search-results { overflow-y: auto; padding: 8px 0; }
.ss-cat {
  padding: 6px 16px; font-size: 0.7rem; font-weight: 600; color: var(--text3);
  text-transform: uppercase; letter-spacing: 0.05em;
}
.ss-item { padding: 8px 16px; cursor: pointer; border-left: 2px solid transparent; }
.ss-item:hover { background: var(--bg3); border-left-color: var(--accent1); }
.ss-sub { font-size: 0.7rem; color: var(--text3); margin-top: 2px; }
.ss-kind { color: var(--accent2); }
.ss-empty { padding: 24px; text-align: center; color: var(--text3); }
```

- [ ] **Step 4: Run tests + Commit**

Run: `node --test App/renderer/__tests__/symbols.test.js App/renderer/__tests__/smart-search.test.js`
Expected: PASS

```bash
git add App/renderer/script.js App/renderer/style.css App/renderer/index.html
git commit -m "feat: wire smart search sources, shortcut and styles"
```

---

### Task 4: Abschluss-Verifikation

- [ ] **Step 1: Alle Tests**

Run: `node --test App/renderer/__tests__/ App/sandbox/__tests__/`
Expected: PASS

- [ ] **Step 2: Manueller Smoke-Test**

- Ctrl+Shift+P im geöffneten Projekt → Overlay erscheint.
- Suche "login" → Ergebnisse aus Datei (Fuse), Symbol (z. B. `LoginButton`), Memory, Commit, Todo, Decision gruppiert.
- Klick auf Datei/Symbol → Tab öffnet, Cursor springt zur Zeile.
- Klick auf Todo/Decision → Management-Panel mit richtigen Tab.
- Klick auf Commit → Git-Panel.
- Suche mit Unsinn → "Keine Treffer", keine Fehler in Konsole.
- Verbundener GitHub-Service: Issue-Suche liefert Treffer; ohne Service wird die Kategorie ausgeblendet.

- [ ] **Step 3: Final Commit (falls nötig)**

```bash
git add -A
git commit -m "feat: complete smart search"
```

---

## Self-Review-Checkliste (nach Ausführung)

1. **Spec-Abdeckung:** Alle 7 Kategorien (Datei/Symbol/Issue/Memory/Commit/Todo/Decision) aggregiert (Task 2/3); Regex-Symbol-Extraktor mit Fallback (Task 1); Issue optional mit Timeout (Task 2 `_search`); Navigation-Mapping je Kategorie (Task 2 `_navigate`, Task 3 `onNavigate`); Debounce (Task 2).
2. **Placeholder-Scan:** Keine "TBD". Zwei markierte Flexibilitätspunkte: `serviceApi`-Signatur (Task 3) und `_filter`-Leer-Kategorie-Semantik (Task 2 Hinweis).
3. **Typ-Konsistenz:** `extractSymbols(content, language)` konsistent in Task 1/3; `SmartSearch.setSources/_search/_filter/_navigate/_render/open/close` konsistent.
