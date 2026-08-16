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
      let timer = null;
      try {
        const res = await Promise.race([
          Promise.resolve(fn(q)),
          new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), 3000); })
        ]);
        out[c] = Array.isArray(res) ? res : [];
      } catch (e) { out[c] = []; } finally { if (timer) clearTimeout(timer); }
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
