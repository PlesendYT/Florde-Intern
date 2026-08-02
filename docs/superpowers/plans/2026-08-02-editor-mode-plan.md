# Editor-Modus + Interaktiver Inline-Diff Implementation Plan (Teilprojekt A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Florde bekommt einen wechselbaren Editor-/Chat-Modus mit editierbarem Monaco-Editor, KI-Auswahl-Aktionsmenü und interaktivem Inline-Diff (Accept/Reject pro Hunk, Zeile, Block, Accept All/Reject All, Edit before Accept).

**Architecture:** Drei neue Renderer-Module: `diff-utils.js` (pure Diff→Hunk-Berechnung, LCS-basiert, ohne Dependencies), `inline-diff.js` (Zustandslogik Accept/Reject, content-basierte Akzeptanz, produziert Edits + gefilterte Hunks, ohne Monaco) und `editor-mode.js` (Modus-Toggle + Auswahl-Aktionsmenü + Prompt-Builder, DOM-gebunden aber in reinen Funktionen getestet). `script.js` liefert nur kleine Bridges (editor, sendMessage, Datei-Kontext) und wendet Edits/Decorations auf Monaco an.

**Tech Stack:** Monaco Editor (`monaco-editor ^0.45.0`), vanilla JS (kein Framework), Node `node:test` für Unit-Tests.

**Spec:** `docs/superpowers/specs/2026-08-02-editor-mode-design.md`

## Global Constraints

- Alle Tests laufen via `node --test` aus dem Repo-Root: `node --test App/renderer/__tests__/<file>.test.js`
- Neue Renderer-Module sind **UMD-artig**: als `<script>`-Tag geladen (attach global) UND via `module.exports` in Node testbar — Guard `if (typeof module !== 'undefined' && module.exports)`.
- `monaco`/`editor` sind nur im Browser global; in Modulen NIE direkt referenzieren außerhalb von Guard-Funktionen.
- Keine neuen npm-Dependencies (jsdiff nur als Browser-Global `Diff` vorhanden, NICHT in node_modules — deshalb eigene LCS-Implementierung in `diff-utils.js`).
- Keine Kommentare in implementiertem Code (bestehende Codebase-Konvention).
- `readOnly`/`domReadOnly` am Haupt-Editor werden entfernt, am DiffViewer (Z. 9018-9019) BLEIBEN sie.
- Speicher-Flow (`saveCurrentFile`/`saveAllTabs`) wird NICHT verändert.

---

### Task 1: `diff-utils.js` — pure Hunk-Berechnung

**Files:**
- Create: `App/renderer/diff-utils.js`
- Create: `App/renderer/__tests__/diff-utils.test.js`

**Interfaces:**
- Produces: `splitLines(text) → string[]`, `computeHunks(oldText, newText) → hunk[]` mit `{ id, startLine, endLine, added: [{line,text}], removed: [{line,text}] }`. `startLine/endLine` = Zeilenbereiche im NEUEN Text (added-Zeilen); `removed` = gelöschte Originalzeilen (für Reject). Reine Einfügungen haben `removed: []`, reine Löschungen `added: []`.

- [ ] **Step 1: Write the failing test file**

```js
// App/renderer/__tests__/diff-utils.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { splitLines, computeHunks } = require('../diff-utils');

describe('splitLines', () => {
  it('splits on newline', () => {
    assert.deepStrictEqual(splitLines('a\nb\nc'), ['a', 'b', 'c']);
  });
  it('empty string gives empty array', () => {
    assert.deepStrictEqual(splitLines(''), ['']);
  });
  it('null gives empty array', () => {
    assert.deepStrictEqual(splitLines(null), ['']);
  });
});

describe('computeHunks', () => {
  it('no changes gives no hunks', () => {
    assert.deepStrictEqual(computeHunks('a\nb\nc', 'a\nb\nc'), []);
  });

  it('pure insertion yields one hunk with added line', () => {
    const hunks = computeHunks('a\nb', 'a\nNEW\nb');
    assert.strictEqual(hunks.length, 1);
    assert.strictEqual(hunks[0].startLine, 2);
    assert.strictEqual(hunks[0].endLine, 2);
    assert.deepStrictEqual(hunks[0].added, [{ line: 2, text: 'NEW' }]);
    assert.deepStrictEqual(hunks[0].removed, []);
  });

  it('pure deletion yields one hunk with removed line', () => {
    const hunks = computeHunks('a\nGONE\nb', 'a\nb');
    assert.strictEqual(hunks.length, 1);
    assert.deepStrictEqual(hunks[0].removed, [{ line: 2, text: 'GONE' }]);
    assert.deepStrictEqual(hunks[0].added, []);
  });

  it('replacement yields hunk with both added and removed', () => {
    const hunks = computeHunks('a\nOLD\nb', 'a\nNEW\nb');
    assert.strictEqual(hunks.length, 1);
    assert.deepStrictEqual(hunks[0].added, [{ line: 2, text: 'NEW' }]);
    assert.deepStrictEqual(hunks[0].removed, [{ line: 2, text: 'OLD' }]);
  });

  it('multiple separated changes yield multiple hunks', () => {
    const hunks = computeHunks('a\nb\nc\nd', 'a\nX\nc\nY');
    assert.strictEqual(hunks.length, 2);
    assert.strictEqual(hunks[0].added[0].line, 2);
    assert.strictEqual(hunks[1].added[0].line, 4);
  });

  it('multi-line insertion at end', () => {
    const hunks = computeHunks('a\nb', 'a\nb\nL1\nL2');
    assert.strictEqual(hunks.length, 1);
    assert.deepStrictEqual(hunks[0].added.map(x => x.text), ['L1', 'L2']);
    assert.strictEqual(hunks[0].startLine, 3);
    assert.strictEqual(hunks[0].endLine, 4);
  });

  it('pure deletion at end yields one hunk', () => {
    const hunks = computeHunks('a\nb\nGONE', 'a\nb');
    assert.strictEqual(hunks.length, 1);
    assert.deepStrictEqual(hunks[0].removed, [{ line: 3, text: 'GONE' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test App/renderer/__tests__/diff-utils.test.js`
Expected: FAIL with "Cannot find module '../diff-utils'"

- [ ] **Step 3: Write the implementation**

```js
// App/renderer/diff-utils.js
function splitLines(text) {
  return (text == null ? '' : text).split('\n');
}

function lcsDiff(aLines, bLines) {
  const n = aLines.length, m = bLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (aLines[i] === bLines[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) { ops.push({ type: 'same' }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: 'del', text: aLines[i] }); i++; }
    else { ops.push({ type: 'add', text: bLines[j] }); j++; }
  }
  while (i < n) { ops.push({ type: 'del', text: aLines[i] }); i++; }
  while (j < m) { ops.push({ type: 'add', text: bLines[j] }); j++; }
  return ops;
}

function computeHunks(oldText, newText) {
  const aLines = splitLines(oldText);
  const bLines = splitLines(newText);
  const ops = lcsDiff(aLines, bLines);
  const hunks = [];
  let aIdx = 1, bIdx = 1;
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op.type === 'same') { aIdx++; bIdx++; continue; }
    let start = bIdx, end = bIdx - 1, added = [], removed = [];
    while (k < ops.length && ops[k].type !== 'same') {
      const cur = ops[k];
      if (cur.type === 'add') { added.push({ line: bIdx, text: cur.text }); end = bIdx; bIdx++; }
      else { removed.push({ line: aIdx, text: cur.text }); aIdx++; }
      k++;
    }
    k--;
    hunks.push({ id: hunks.length, startLine: start, endLine: end, added, removed });
  }
  return hunks;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { splitLines, computeHunks, lcsDiff };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test App/renderer/__tests__/diff-utils.test.js`
Expected: PASS (all tests green)

- [ ] **Step 5: Commit**

```bash
git add App/renderer/diff-utils.js App/renderer/__tests__/diff-utils.test.js
git commit -m "feat: add pure diff hunk computation (diff-utils)"
```

---

### Task 2: `inline-diff.js` — Zustandslogik Accept/Reject

**Files:**
- Create: `App/renderer/inline-diff.js`
- Create: `App/renderer/__tests__/inline-diff.test.js`

**Interfaces:**
- Consumes: `computeHunks(oldText, newText)` from `../diff-utils`
- Produces: `createDiffState(fileName, originalText, newText) → { fileName, originalText, currentText, accepted: Set }`
- `pendingHunks(state) → hunk[]` (added-Zeilen gefiltert nach accepted-Inhalten)
- `rejectHunk(state, hunkId) → { edits, state }` — edits: `[{ startLine, endLine, newLines }]` (1-basiert), ersetzt added-Zeilen durch removed-Originalzeilen bzw. löscht reine Einfügungen; reinen Löschungen fügt Originalzeilen an Position ein
- `acceptHunk(state, hunkId) → state` (added-Inhalte zu `accepted` hinzufügen)
- `acceptLine(state, hunkId, lineNo) → state`, `rejectLine(state, hunkId, lineNo) → { edits, state }`
- `acceptAll(state)`, `rejectAll(state) → { edits, state }`
- `applyEditsToText(text, edits) → string` (pure)
- Akzeptanz ist **content-basiert** (`accepted` = Set von Zeilentexten), damit Edit-before-Accept und spätere Reverts nicht brechen.

- [ ] **Step 1: Write the failing test file**

```js
// App/renderer/__tests__/inline-diff.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  createDiffState, pendingHunks, acceptHunk, rejectHunk,
  acceptLine, rejectLine, acceptAll, rejectAll, applyEditsToText
} = require('../inline-diff');

const OLD = 'a\nOLD\nb';
const NEW = 'a\nNEW1\nNEW2\nb';

describe('createDiffState', () => {
  it('keeps original and current text', () => {
    const s = createDiffState('f.js', OLD, NEW);
    assert.strictEqual(s.fileName, 'f.js');
    assert.strictEqual(s.originalText, OLD);
    assert.strictEqual(s.currentText, NEW);
    assert.ok(s.accepted instanceof Set);
  });
});

describe('pendingHunks', () => {
  it('returns all hunks initially', () => {
    const s = createDiffState('f.js', OLD, NEW);
    const h = pendingHunks(s);
    assert.strictEqual(h.length, 1);
    assert.deepStrictEqual(h[0].added.map(x => x.text), ['NEW1', 'NEW2']);
  });
  it('empty after acceptAll', () => {
    const s = createDiffState('f.js', OLD, NEW);
    const s2 = acceptAll(s);
    assert.strictEqual(pendingHunks(s2).length, 0);
  });
});

describe('acceptHunk', () => {
  it('adds added line texts to accepted', () => {
    const s = createDiffState('f.js', OLD, NEW);
    const s2 = acceptHunk(s, 0);
    assert.ok(s2.accepted.has('NEW1'));
    assert.ok(s2.accepted.has('NEW2'));
    assert.strictEqual(pendingHunks(s2).length, 0);
  });
});

describe('acceptLine', () => {
  it('accepts only the given added line', () => {
    const s = createDiffState('f.js', OLD, NEW);
    const s2 = acceptLine(s, 0, 2);
    assert.ok(s2.accepted.has('NEW1'));
    assert.ok(!s2.accepted.has('NEW2'));
    const pending = pendingHunks(s2);
    assert.deepStrictEqual(pending[0].added.map(x => x.text), ['NEW2']);
  });
});

describe('rejectHunk', () => {
  it('replaces added lines with original removed lines', () => {
    const s = createDiffState('f.js', OLD, NEW);
    const { edits } = rejectHunk(s, 0);
    assert.strictEqual(edits.length, 1);
    assert.strictEqual(edits[0].startLine, 2);
    assert.strictEqual(edits[0].endLine, 3);
    assert.deepStrictEqual(edits[0].newLines, ['OLD']);
  });
  it('deletion-only hunk inserts original lines', () => {
    const s = createDiffState('f.js', 'a\nGONE\nb', 'a\nb');
    const { edits } = rejectHunk(s, 0);
    assert.strictEqual(edits.length, 1);
    assert.strictEqual(edits[0].newLines.length, 1);
    assert.strictEqual(edits[0].newLines[0], 'GONE');
  });
});

describe('rejectLine', () => {
  it('removes one added line', () => {
    const s = createDiffState('f.js', OLD, NEW);
    const { edits } = rejectLine(s, 0, 2);
    assert.strictEqual(edits.length, 1);
    assert.strictEqual(edits[0].startLine, 2);
    assert.strictEqual(edits[0].endLine, 2);
    assert.deepStrictEqual(edits[0].newLines, []);
  });
});

describe('applyEditsToText', () => {
  it('applies a replacement edit', () => {
    const text = 'a\nNEW1\nNEW2\nb';
    const out = applyEditsToText(text, [{ startLine: 2, endLine: 3, newLines: ['OLD'] }]);
    assert.strictEqual(out, 'a\nOLD\nb');
  });
  it('applies a deletion edit', () => {
    const text = 'a\nNEW1\nNEW2\nb';
    const out = applyEditsToText(text, [{ startLine: 2, endLine: 3, newLines: [] }]);
    assert.strictEqual(out, 'a\nb');
  });
  it('applies insertion edit (startLine > endLine)', () => {
    const text = 'a\nb';
    const out = applyEditsToText(text, [{ startLine: 2, endLine: 1, newLines: ['GONE'] }]);
    assert.strictEqual(out, 'a\nGONE\nb');
  });
});

describe('rejectAll', () => {
  it('restores original text', () => {
    const s = createDiffState('f.js', OLD, NEW);
    const { edits, state } = rejectAll(s);
    assert.strictEqual(applyEditsToText(s.currentText, edits), OLD);
    assert.strictEqual(state.currentText, OLD);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test App/renderer/__tests__/inline-diff.test.js`
Expected: FAIL with "Cannot find module '../inline-diff'"

- [ ] **Step 3: Write the implementation**

```js
// App/renderer/inline-diff.js
const { splitLines, computeHunks } = (typeof require !== 'undefined' && require('../diff-utils')) || {};

function createDiffState(fileName, originalText, newText) {
  return { fileName, originalText, currentText: newText, accepted: new Set() };
}

function pendingHunks(state) {
  const hunks = computeHunks(state.originalText, state.currentText);
  const out = [];
  for (const h of hunks) {
    const added = h.added.filter(x => !state.accepted.has(x.text));
    const removed = h.removed;
    if (added.length === 0 && removed.length === 0) continue;
    out.push({ ...h, added });
  }
  return out;
}

function _addedTexts(state) {
  return computeHunks(state.originalText, state.currentText)
    .flatMap(h => h.added.map(x => x.text));
}

function _clone(state) {
  return { ...state, accepted: new Set(state.accepted) };
}

function acceptHunk(state, hunkId) {
  const s = _clone(state);
  const hunk = computeHunks(s.originalText, s.currentText).find(h => h.id === hunkId);
  if (!hunk) return s;
  hunk.added.forEach(x => s.accepted.add(x.text));
  return s;
}

function acceptLine(state, hunkId, lineNo) {
  const s = _clone(state);
  const hunk = computeHunks(s.originalText, s.currentText).find(h => h.id === hunkId);
  if (!hunk) return s;
  const line = hunk.added.find(x => x.line === lineNo);
  if (line) s.accepted.add(line.text);
  return s;
}

function acceptAll(state) {
  const s = _clone(state);
  _addedTexts(s).forEach(t => s.accepted.add(t));
  return s;
}

function rejectHunk(state, hunkId) {
  const hunk = computeHunks(state.originalText, state.currentText).find(h => h.id === hunkId);
  if (!hunk) return { edits: [], state };
  const originalLines = hunk.removed.map(x => x.text);
  let edits;
  if (hunk.added.length > 0) {
    edits = [{ startLine: hunk.startLine, endLine: hunk.endLine, newLines: originalLines }];
  } else {
    edits = [{ startLine: hunk.startLine, endLine: hunk.startLine - 1, newLines: originalLines }];
  }
  const next = _clone(state);
  next.currentText = applyEditsToText(next.currentText, edits);
  return { edits, state: next };
}

function rejectLine(state, hunkId, lineNo) {
  const hunk = computeHunks(state.originalText, state.currentText).find(h => h.id === hunkId);
  if (!hunk) return { edits: [], state };
  const line = hunk.added.find(x => x.line === lineNo);
  if (!line) return { edits: [], state };
  const edits = [{ startLine: line.line, endLine: line.line, newLines: [] }];
  const next = _clone(state);
  next.currentText = applyEditsToText(next.currentText, edits);
  return { edits, state: next };
}

function rejectAll(state) {
  const edits = [{ startLine: 1, endLine: splitLines(state.currentText).length, newLines: splitLines(state.originalText) }];
  const next = _clone(state);
  next.currentText = state.originalText;
  return { edits, state: next };
}

function applyEditsToText(text, edits) {
  let lines = splitLines(text);
  const sorted = [...edits].sort((a, b) => b.startLine - a.startLine);
  for (const e of sorted) {
    const start = e.startLine - 1;
    const end = e.endLine - 1;
    if (start > end) {
      lines.splice(start, 0, ...e.newLines);
    } else {
      lines.splice(start, end - start + 1, ...e.newLines);
    }
  }
  return lines.join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createDiffState, pendingHunks, acceptHunk, rejectHunk,
    acceptLine, rejectLine, acceptAll, rejectAll, applyEditsToText
  };
}
```

> Hinweis: In `diff-utils.js` wird `computeHunks` auf `window`/global gelegt (script-tag) bzw. via `module.exports` exportiert. In `inline-diff.js` wird es über die UMD-Form `(typeof require !== 'undefined' && require('../diff-utils'))` geladen; im Browser ist es als Global `computeHunks` verfügbar. Falls nötig: Fallback `typeof window !== 'undefined' ? window : globalThis` verwenden.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test App/renderer/__tests__/inline-diff.test.js`
Expected: PASS (alle Tests grün)

- [ ] **Step 5: Commit**

```bash
git add App/renderer/inline-diff.js App/renderer/__tests__/inline-diff.test.js
git commit -m "feat: add inline diff accept/reject state logic"
```

---

### Task 3: `editor-mode.js` — Modus-Umschaltung + Aktionsmenü + Prompt-Builder

**Files:**
- Create: `App/renderer/editor-mode.js`
- Create: `App/renderer/__tests__/editor-mode.test.js`

**Interfaces:**
- Produces: `EditorMode` mit `init()`, `setMode(mode)`, `getMode()`, `showSelectionMenu(selection, ctx)`, `_buildPrompt(action, text, lang, fileName, goal)`
- `_buildPrompt` ist pure und testbar. `setMode` akzeptiert `'editor'|'chat'`, schreibt `localStorage['florde-app-mode']` und ruft optionalen Callback `EditorMode.onModeChange`.
- `localStorage` wird über einen injizierbaren Store gemockt: `EditorMode._store = { getItem, setItem }` (Default: `window.localStorage`, im Node-Test durch Mock ersetzt).

- [ ] **Step 1: Write the failing test file**

```js
// App/renderer/__tests__/editor-mode.test.js
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { EditorMode } = require('../editor-mode');

function mockStore() {
  const data = {};
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    _data: data
  };
}

beforeEach(() => {
  EditorMode._store = mockStore();
  EditorMode.onModeChange = null;
});

describe('EditorMode.setMode', () => {
  it('defaults to editor when no stored mode', () => {
    assert.strictEqual(EditorMode.getMode(), 'editor');
  });
  it('persists chat mode', () => {
    EditorMode.setMode('chat');
    assert.strictEqual(EditorMode.getMode(), 'chat');
    assert.strictEqual(EditorMode._store.getItem('florde-app-mode'), 'chat');
  });
  it('persists editor mode', () => {
    EditorMode.setMode('chat');
    EditorMode.setMode('editor');
    assert.strictEqual(EditorMode.getMode(), 'editor');
  });
  it('rejects invalid mode', () => {
    EditorMode.setMode('bogus');
    assert.strictEqual(EditorMode.getMode(), 'editor');
  });
  it('fires onModeChange callback', () => {
    let fired = null;
    EditorMode.onModeChange = (m) => { fired = m; };
    EditorMode.setMode('chat');
    assert.strictEqual(fired, 'chat');
  });
  it('reads stored mode on first getMode', () => {
    EditorMode._store.setItem('florde-app-mode', 'chat');
    assert.strictEqual(EditorMode.getMode(), 'chat');
  });
});

describe('EditorMode._buildPrompt', () => {
  const sel = 'const x = 1;';
  const ctx = { text: sel, lang: 'javascript', fileName: 'app.js', goal: 'besser' };

  it('builds explain prompt with code fence', () => {
    const p = EditorMode._buildPrompt('explain', ctx);
    assert.ok(p.includes('app.js'));
    assert.ok(p.includes('```javascript\n' + sel + '\n```'));
  });
  it('builds whatis prompt', () => {
    const p = EditorMode._buildPrompt('whatis', ctx);
    assert.ok(p.toLowerCase().includes('was ist das'));
    assert.ok(p.includes(sel));
  });
  it('builds improve prompt with goal', () => {
    const p = EditorMode._buildPrompt('improve', ctx);
    assert.ok(p.includes('besser'));
    assert.ok(p.includes(sel));
  });
  it('builds change prompt with free instruction', () => {
    const p = EditorMode._buildPrompt('change', { ...ctx, goal: 'Mach es async' });
    assert.ok(p.includes('Mach es async'));
  });
  it('builds refactor prompt', () => {
    const p = EditorMode._buildPrompt('refactor', ctx);
    assert.ok(p.toLowerCase().includes('refactor'));
  });
  it('includes file context header', () => {
    const p = EditorMode._buildPrompt('explain', ctx);
    assert.ok(p.includes('Datei: app.js'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test App/renderer/__tests__/editor-mode.test.js`
Expected: FAIL with "Cannot find module '../editor-mode'"

- [ ] **Step 3: Write the implementation**

```js
// App/renderer/editor-mode.js
const EDITOR_MODE_KEY = 'florde-app-mode';

const EditorMode = {
  _store: (typeof window !== 'undefined' && window.localStorage) ? window.localStorage : null,
  _mode: null,
  onModeChange: null,

  getMode() {
    if (this._mode) return this._mode;
    if (this._store) {
      const stored = this._store.getItem(EDITOR_MODE_KEY);
      if (stored === 'chat' || stored === 'editor') return stored;
    }
    return 'editor';
  },

  setMode(mode) {
    if (mode !== 'chat' && mode !== 'editor') return this._mode || 'editor';
    this._mode = mode;
    if (this._store) this._store.setItem(EDITOR_MODE_KEY, mode);
    if (this.onModeChange) this.onModeChange(mode);
    return mode;
  },

  showSelectionMenu(selection, ctx) {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById('editor-action-menu');
    if (existing) existing.remove();
    const menu = document.createElement('div');
    menu.id = 'editor-action-menu';
    menu.className = 'editor-action-menu hidden';
    menu.innerHTML =
      '<button class="eam-btn" data-action="whatis">Was ist das?</button>' +
      '<button class="eam-btn" data-action="explain">Erklären</button>' +
      '<button class="eam-btn" data-action="improve">Verbessern</button>' +
      '<button class="eam-btn" data-action="change">Ändern…</button>' +
      '<button class="eam-btn" data-action="refactor">Refactoring</button>';
    document.body.appendChild(menu);
    const pos = ctx && ctx.position ? ctx.position : { left: 0, top: 0 };
    menu.style.left = pos.left + 'px';
    menu.style.top = pos.top + 'px';
    menu.classList.remove('hidden');

    menu.querySelectorAll('.eam-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        menu.remove();
        if (this.onAction && ctx) this.onAction(action, ctx);
      });
    });
    return menu;
  },

  _buildPrompt(action, ctx) {
    const header = 'Datei: ' + ctx.fileName + '\nSprache: ' + (ctx.lang || 'unbekannt') + '\n\n';
    const fence = '```' + (ctx.lang || '') + '\n' + ctx.text + '\n```';
    switch (action) {
      case 'whatis':
        return header + 'Was ist das? Erkläre mir diesen Codeabschnitt kurz und verständlich auf Deutsch.\n\n' + fence;
      case 'explain':
        return header + 'Erkläre mir diesen Codeabschnitt ausführlich auf Deutsch.\n\n' + fence;
      case 'improve':
        return header + 'Verbessere diesen Codeabschnitt' +
          (ctx.goal ? ' (' + ctx.goal + ')' : '') +
          '. Gib das Ergebnis als vollständigen Dateiinhalt im Code-Block zurück.\n\n' + fence;
      case 'change':
        return header + 'Ändere diesen Codeabschnitt wie folgt: ' + (ctx.goal || '') +
          '. Gib das Ergebnis als vollständigen Dateiinhalt im Code-Block zurück.\n\n' + fence;
      case 'refactor':
        return header + 'Refactore diesen Codeabschnitt (Klarheit, DRY, kleine Funktionen). Gib das Ergebnis als vollständigen Dateiinhalt im Code-Block zurück.\n\n' + fence;
      default:
        return header + fence;
    }
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EditorMode };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test App/renderer/__tests__/editor-mode.test.js`
Expected: PASS (alle Tests grün)

- [ ] **Step 5: Commit**

```bash
git add App/renderer/editor-mode.js App/renderer/__tests__/editor-mode.test.js
git commit -m "feat: add editor mode toggle, action menu and prompt builder"
```

---

### Task 4: HTML — Toggle-Buttons + Script-Tags

**Files:**
- Modify: `App/renderer/index.html:115-164` (Titlebar) und `App/renderer/index.html:1190-1209` (Script-Tags)

**Interfaces:**
- Produces: `#btn-mode-editor`, `#btn-mode-chat` in `titlebar-left` (nach `#privacy-indicator`); Script-Tags `editor-mode.js`, `diff-utils.js`, `inline-diff.js` VOR `script.js`.

- [ ] **Step 1: Add toggle buttons**

In `App/renderer/index.html` innerhalb `<div class="titlebar-left">` (nach Zeile 120, `#privacy-indicator`):

```html
<button id="btn-mode-editor" class="mode-toggle-btn active" title="Editor-Modus">&lt;/&gt;</button>
<button id="btn-mode-chat" class="mode-toggle-btn" title="Chat-Modus">&#128172;</button>
```

- [ ] **Step 2: Add script tags before `script.js`**

In `App/renderer/index.html` vor `<script src="script.js"></script>` (Zeile 1209):

```html
<script src="diff-utils.js"></script>
<script src="inline-diff.js"></script>
<script src="editor-mode.js"></script>
```

- [ ] **Step 3: Commit**

```bash
git add App/renderer/index.html
git commit -m "feat: add editor/chat mode toggle buttons and module script tags"
```

---

### Task 5: `script.js` — Integration (editierbarer Editor, Modus, Aktionsmenü, Inline-Diff-Anwendung)

**Files:**
- Modify: `App/renderer/script.js:8758-8771` (Monaco-Init, readOnly entfernen, setupCodeToolbar ersetzen)
- Modify: `App/renderer/script.js:8793-8852` (Code-Toolbar → EditorMode-Aktionsmenü)
- Modify: `App/renderer/script.js` (Init-Aufrufe + Bridges am Ende)

**Interfaces:**
- Consumes: `EditorMode`, `InlineDiff`, `computeHunks` (Global via script-tag)
- Produces: Bridge-Funktion `applyInlineDiffToEditor(fileName, newContent)` (wendet Diff auf Monaco an, speichert State), `commitCurrentFile()` (Accept All + speichern)
- Nutzt bestehende Globals: `editor`, `openTabs`, `activeTabIndex`, `tabContents`, `tabDirty`, `currentProject`, `sendMessage`, `detectLanguage`, `switchTab`, `renderFileTree`, `logToTerminal`, `saveCurrentFile`.

- [ ] **Step 1: Remove readOnly flags from main editor**

In `App/renderer/script.js:8762-8763`:

```js
      readOnly: true,
      domReadOnly: true,
```
→
```js
      readOnly: false,
      domReadOnly: false,
```

- [ ] **Step 2: Replace `setupCodeToolbar` call with EditorMode wiring**

In `App/renderer/script.js:8771` ersetze `setupCodeToolbar(editor);` durch:

```js
    EditorMode.onModeChange = applyModeToLayout;
    applyModeToLayout(EditorMode.getMode());
    EditorMode.onAction = handleEditorAction;
```

- [ ] **Step 3: Add `applyModeToLayout`, `handleEditorAction`, `applyInlineDiffToEditor`**

Ersetze den gesamten Block `setupCodeToolbar` bis `hideCodeToolbar` (`script.js:8793-8852`) durch:

```js
function applyModeToLayout(mode) {
  const body = document.body;
  body.classList.toggle('app-mode-editor', mode === 'editor');
  body.classList.toggle('app-mode-chat', mode === 'chat');
  const btnE = document.getElementById('btn-mode-editor');
  const btnC = document.getElementById('btn-mode-chat');
  if (btnE) btnE.classList.toggle('active', mode === 'editor');
  if (btnC) btnC.classList.toggle('active', mode === 'chat');
}

document.getElementById('btn-mode-editor')?.addEventListener('click', () => EditorMode.setMode('editor'));
document.getElementById('btn-mode-chat')?.addEventListener('click', () => EditorMode.setMode('chat'));

function handleEditorAction(action, ctx) {
  if (!editor || !editor.getModel()) return;
  const fileName = openTabs[activeTabIndex] || 'unknown';
  const sel = editor.getSelection();
  const text = ctx.text || (editor.getModel().getValueInRange(sel) || '');
  if (!text.trim()) return;
  const lang = ctx.lang || tabLanguages[fileName] || detectLanguage(fileName) || '';
  if (action === 'whatis' || action === 'explain') {
    sendMessage(EditorMode._buildPrompt(action, { text, lang, fileName }));
    return;
  }
  let goal = '';
  if (action === 'improve') {
    const g = prompt('Verbesserungsziel (optional):', '');
    if (g === null) return;
    goal = g;
  } else if (action === 'change') {
    const g = prompt('Was soll geändert werden?:', '');
    if (g === null) return;
    goal = g;
  }
  const promptText = EditorMode._buildPrompt(action, { text, lang, fileName, goal });
  EditorMode._pendingDiff = { fileName, originalText: editor.getModel().getValue(), promptText };
  sendMessage(promptText);
}

function applyInlineDiffToEditor(fileName, newContent) {
  if (!editor || !editor.getModel()) return;
  if (fileName !== (openTabs[activeTabIndex] || '')) return;
  const originalText = editor.getModel().getValue();
  const state = createDiffState(fileName, originalText, newContent);
  InlineDiff._states[fileName] = state;
  editor.getModel().setValue(newContent);
  renderInlineDiffDecorations(fileName);
}

function renderInlineDiffDecorations(fileName) {
  if (!editor || !editor.getModel()) return;
  const state = InlineDiff._states[fileName];
  if (!state) { editor.deltaDecorations([], []); return; }
  const hunks = pendingHunks(state);
  const decos = [];
  hunks.forEach(h => {
    h.added.forEach(x => {
      decos.push({
        range: new monaco.Range(x.line, 1, x.line, 1),
        options: {
          isWholeLine: true,
          className: 'inline-diff-added',
          linesDecorationsClassName: 'inline-diff-added-gutter',
          glyphMargin: true,
          glyphMarginClassName: 'inline-diff-glyph'
        }
      });
    });
    if (h.removed.length > 0 && h.added.length === 0) {
      decos.push({
        range: new monaco.Range(h.startLine, 1, h.startLine, 1),
        options: { isWholeLine: true, className: 'inline-diff-removed', linesDecorationsClassName: 'inline-diff-removed-gutter' }
      });
    }
  });
  InlineDiff._decoIds = editor.deltaDecorations(InlineDiff._decoIds || [], decos);
}

function commitCurrentFile() {
  const fileName = openTabs[activeTabIndex];
  if (!fileName || !InlineDiff._states[fileName]) return;
  const state = InlineDiff._states[fileName];
  const s = acceptAll(state);
  InlineDiff._states[fileName] = s;
  InlineDiff._decoIds = editor.deltaDecorations(InlineDiff._decoIds || [], []);
  delete InlineDiff._states[fileName];
  saveCurrentFile();
  logToTerminal('Änderungen übernommen und gespeichert.', 'success');
}

function rejectCurrentFile() {
  const fileName = openTabs[activeTabIndex];
  if (!fileName || !InlineDiff._states[fileName]) return;
  const state = InlineDiff._states[fileName];
  const { edits } = rejectAll(state);
  applyEditsToMonaco(edits);
  InlineDiff._states[fileName] = rejectAll(state).state;
  renderInlineDiffDecorations(fileName);
}

function applyEditsToMonaco(edits) {
  if (!editor || !editor.getModel() || !edits) return;
  const ops = edits.map(e => ({
    range: new monaco.Range(e.startLine, 1, e.endLine, 1),
    text: e.newLines.length ? e.newLines.join('\n') : '',
    forceMoveMarkers: true
  }));
  editor.executeEdits('inline-diff', ops);
}

function applyHunkDecision(fileName, hunkId, kind, lineNo) {
  const state = InlineDiff._states[fileName];
  if (!state) return;
  let edits = [], next;
  if (kind === 'accept') { next = acceptHunk(state, hunkId); }
  else if (kind === 'reject') { const r = rejectHunk(state, hunkId); edits = r.edits; next = r.state; }
  else if (kind === 'acceptLine') { next = acceptLine(state, hunkId, lineNo); }
  else if (kind === 'rejectLine') { const r = rejectLine(state, hunkId, lineNo); edits = r.edits; next = r.state; }
  if (edits.length) applyEditsToMonaco(edits);
  InlineDiff._states[fileName] = next;
  renderInlineDiffDecorations(fileName);
}
```

> Anmerkung: `InlineDiff._states`/`_decoIds` sind einfache State-Slots auf dem Objekt — im Plan als definierte Schnittstellen geführt. Für sauberere Struktur können sie auch als Moduleigene `Map` geführt werden; die script.js-Bridges greifen dann auf `InlineDiff.getState(fileName)`/`setState(...)` zu. InlineDiff wird in Task 2 entsprechend um eine `getState/setState`-Schnittstelle ergänzt, sofern nötig.

- [ ] **Step 4: Hover-Aktionen für Hunks (floating toolbar)**

Ergänze in `renderInlineDiffDecorations` — nach dem Loop — einen Toolbar-Aufruf pro Hunk:

```js
function showHunkToolbar(fileName, hunk) {
  if (typeof document === 'undefined') return;
  let bar = document.getElementById('hunk-toolbar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'hunk-toolbar'; document.body.appendChild(bar); }
  bar.innerHTML =
    '<button class="ht-btn" data-k="accept">Accept</button>' +
    '<button class="ht-btn" data-k="reject">Reject</button>' +
    '<button class="ht-btn" data-k="acceptLine">Accept Line</button>' +
    '<button class="ht-btn" data-k="rejectLine">Reject Line</button>' +
    '<button class="ht-btn ht-edit" data-k="edit">Edit before Accept</button>';
  const pos = editor.getScrolledVisiblePosition({ lineNumber: hunk.startLine, column: 1 });
  const editorDom = document.getElementById('editor-container');
  const rect = editorDom ? editorDom.getBoundingClientRect() : { top: 0, left: 0 };
  bar.style.left = (rect.left + (pos ? pos.left : 0) + 10) + 'px';
  bar.style.top = (rect.top + (pos ? pos.top : 0) - 40) + 'px';
  bar.style.display = 'flex';
  bar.onclick = (ev) => {
    const b = ev.target.closest('.ht-btn');
    if (!b) return;
    if (b.dataset.k === 'edit') { /* Edit before Accept: Nutzer bearbeitet direkt im Editor; Markierung bleibt bis Accept */ }
    else if (b.dataset.k === 'accept') applyHunkDecision(fileName, hunk.id, 'accept');
    else if (b.dataset.k === 'reject') applyHunkDecision(fileName, hunk.id, 'reject');
    else if (b.dataset.k === 'acceptLine') applyHunkDecision(fileName, hunk.id, 'acceptLine', hunk.added[0] && hunk.added[0].line);
    else if (b.dataset.k === 'rejectLine') applyHunkDecision(fileName, hunk.id, 'rejectLine', hunk.added[0] && hunk.added[0].line);
    else if (b.dataset.k === 'acceptAll') applyHunkDecision(fileName, -1, 'acceptAll');
    else if (b.dataset.k === 'rejectAll') rejectCurrentFile();
  };
}
```

Ergänze zusätzlich **Accept All / Reject All** global im Titelbereich des Diff-Indikators (Status-Leiste), z. B. `commitCurrentFile()`/`rejectCurrentFile()`-Buttons im Chat-Header.

- [ ] **Step 5: Wire captured edit_file result to inline diff**

Suche in `script.js` die Stelle, an der der `edit_file`-Tool-Call ausgewertet wird (die bestehende Chat-Pipeline erzeugt `changes` für `showDiffView`). Ergänze vor dem Fallback:

```js
      const singleChange = changes && changes.length === 1;
      if (singleChange && openTabs.indexOf(changes[0].file) === activeTabIndex) {
        applyInlineDiffToEditor(changes[0].file, changes[0].code);
        continue;
      }
```

> Falls die Tool-Pipeline noch keine `changes`-Struktur an der Stelle hat, wird dieser Hook im tatsächlichen Code anhand des bestehenden `edit_file`/`write_file`-Handlers angepasst (gleiche `{file, code}`-Form wie `showDiffView`).

- [ ] **Step 6: Commit**

```bash
git add App/renderer/script.js
git commit -m "feat: integrate editable editor, mode toggle, action menu and inline diff"
```

---

### Task 6: CSS — Modus-Layout, Aktionsmenü, Diff-Decorations

**Files:**
- Modify: `App/renderer/style.css` (append am Ende)

- [ ] **Step 1: Mode-Layout + Toggle + Menü + Decorationen**

```css
/* ===== Editor/Chat Mode ===== */
.mode-toggle-btn {
  background: transparent; border: 1px solid transparent; color: var(--text3);
  font-size: 0.8rem; cursor: pointer; padding: 2px 8px; border-radius: 4px;
  font-family: monospace;
}
.mode-toggle-btn:hover { color: var(--text); background: var(--bg3); }
.mode-toggle-btn.active { color: var(--accent1); border-color: var(--accent1); }

body.app-mode-editor .chat-panel { width: 320px; min-width: 320px; }
body.app-mode-chat .chat-panel { flex: 1; min-width: 300px; }
body.app-mode-editor .editor-panel { flex: 1; }
body.app-mode-chat .editor-panel { width: 300px; min-width: 240px; }

/* ===== Editor Action Menu ===== */
.editor-action-menu {
  position: fixed; z-index: 10002; display: flex; flex-direction: column;
  background: var(--bg2); border: 1px solid var(--border); border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4); padding: 4px; gap: 2px;
}
.eam-btn {
  background: transparent; border: none; color: var(--text1); text-align: left;
  padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.8rem;
}
.eam-btn:hover { background: var(--bg3); }

/* ===== Inline Diff Decorations ===== */
.inline-diff-added { background: rgba(34,197,94,0.18); }
.inline-diff-added-gutter { border-left: 3px solid #22c55e; }
.inline-diff-removed { background: rgba(239,68,68,0.18); }
.inline-diff-removed-gutter { border-left: 3px solid #ef4444; }
.inline-diff-glyph { background: #22c55e; border-radius: 50%; }

/* ===== Hunk Toolbar ===== */
#hunk-toolbar {
  position: fixed; z-index: 10003; display: none; gap: 4px;
  background: var(--bg2); border: 1px solid var(--border); border-radius: 6px;
  padding: 4px; box-shadow: 0 4px 16px rgba(0,0,0,0.4);
}
.ht-btn {
  background: var(--bg3); border: 1px solid var(--border2); color: var(--text1);
  font-size: 0.7rem; padding: 3px 8px; border-radius: 4px; cursor: pointer;
}
.ht-btn:hover { background: var(--accent1); color: #fff; }
.ht-edit { border-style: dashed; }
```

- [ ] **Step 2: Commit**

```bash
git add App/renderer/style.css
git commit -m "feat: add mode layout, action menu and inline diff styles"
```

---

### Task 7: Abschluss-Integration + manuelle Verifikation

**Files:**
- Modify: `App/renderer/script.js` (ggf. Init-Reihenfolge/kleine Korrekturen)

- [ ] **Step 1: Sicherstellen, dass alle neuen Module vor `script.js` geladen sind und Init läuft**

Prüfen: `index.html` lädt `diff-utils.js`, `inline-diff.js`, `editor-mode.js` VOR `script.js`. `EditorMode.init()` existiert nicht als Pflichtaufruf — die Wiring-Listeners (Task 5 Step 2/3) laufen direkt beim Skript-Evaluieren. Bei Bedarf `EditorMode.init()` ergänzen und in `script.js` nach Monaco-Init aufrufen (kompatibel mit Task 3 API).

- [ ] **Step 2: Alle Tests laufen lassen**

Run: `node --test App/renderer/__tests__/diff-utils.test.js App/renderer/__tests__/inline-diff.test.js App/renderer/__tests__/editor-mode.test.js`
Expected: PASS

- [ ] **Step 3: Bestehende Sandbox-Tests weiterhin grün**

Run: `node --test App/sandbox/__tests__/`
Expected: PASS (keine Regression)

- [ ] **Step 4: Manuelle Smoke-Tests**

- App starten (`npm start` in `App/`): Editor öffnet Datei → Text ist **editierbar** (readOnly weg).
- Mode-Toggle: `</>`/Chat-Buttons wechseln Layout (body-Klassen), Standard Editor-Modus.
- Text auswählen → Aktionsmenü erscheint mit "Was ist das?/Erklären/Verbessern/Ändern…/Refactoring".
- "Verbessern" → Chat-Anfrage → `edit_file`-Ergebnis (eine Datei, offener Tab) wird als **Inline-Diff** im Editor angewendet (grüne Markierungen).
- Hunk-Toolbar: Accept/Reject/Accept Line/Reject Line/Accept All/Reject All funktionieren; Reject stellt Original wieder her.
- Edit before Accept: Text direkt editierbar, Markierung bleibt, Accept bestätigt, Speichern (Ctrl+S) übernimmt.

- [ ] **Step 5: Final Commit (falls Änderungen)**

```bash
git add -A
git commit -m "feat: complete editor mode with interactive inline diff"
```

---

## Self-Review-Checkliste (nach Ausführung)

1. **Spec-Abdeckung:** Modus-Toggle (Task 3/5), editierbarer Editor (Task 5 Step 1), Aktionsmenü ersetzt Code-Toolbar (Task 5 Step 2), Inline-Diff mit Accept All/Reject All/Accept Line/Reject Line/Accept Block (Accept=Block)/Edit before Accept (Task 2+5), Diff-Indikator (Task 5 Step 4 + CSS), Tests je Modul (Tasks 1-3).
2. **Placeholder-Scan:** Kein "TBD/implement later"; einzige bewusste Flexibilität: exakter Hook-Punkt für `edit_file`-Ergebnis in Task 5 Step 5 (markiert, mit beschriebenem Schema `{file, code}`).
3. **Typ-Konsistenz:** `createDiffState/pendingHunks/acceptHunk/rejectHunk/acceptLine/rejectLine/acceptAll/rejectAll/applyEditsToText` sind überall identisch benannt; `edits = [{startLine,endLine,newLines}]` konsistent (1-basiert).
