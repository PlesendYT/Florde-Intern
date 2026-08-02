# Einsteiger-UI Implementation Plan (Teilprojekt C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Florde wird für Einsteiger übersichtlicher: First-Run-Tour, "⋮ Mehr"-Menü in der Titlebar (fortgeschrittene Buttons im Einsteiger-Modus), Sidebar-Gruppierung, Toasts für Aktions-Feedback, fehlende Tooltips. Umschaltbar Einsteiger/Erweitert, Standard Einsteiger.

**Architecture:** Neue Module `toast.js` (reine Toast-Queue, testbar) und `ui-level.js` (Level-Logik + Tour-Steuerung, localStorage über injizierbaren Store). `index.html` bekommt Onboarding-Modal + "⋮ Mehr"-Menü; `style.css` steuert Sichtbarkeit/Dichte über `body.ui-level-beginner/-advanced`; `script.js` ruft `UiLevel.init()` und ersetzt Kern-Erfolgsmeldungen durch `showToast`.

**Tech Stack:** Vanilla JS, Electron. Keine neuen Dependencies.

**Spec:** `docs/superpowers/specs/2026-08-02-beginner-ui-design.md`

## Global Constraints

- Tests laufen via `node --test` aus dem Repo-Root: `node --test App/renderer/__tests__/<file>.test.js`
- Neue Renderer-Module sind UMD-artig (script-tag + `module.exports` Guard).
- Persistenz: `localStorage['florde-ui-level']` = `'beginner'|'advanced'`, Standard `'beginner'`; Tour-Flag `florde-seen-onboarding`.
- CSS-Steuerung über `body.ui-level-beginner` / `body.ui-level-advanced`; keine doppelte Logik.
- Keine Umbenennung bestehender IDs/Funktionen; nur HTML/CSS/Aufruf-Ebene.
- Keine Kommentare in implementiertem Code.

---

### Task 1: `toast.js` — Toast-Queue

**Files:**
- Create: `App/renderer/toast.js`
- Create: `App/renderer/__tests__/toast.test.js`

**Interfaces:**
- Produces: `showToast(message, type='info', duration=2500)`; `ToastQueue` mit `_messages`, `push(msg)`, `pop()`, `peek()` (pure, testbar). `showToast` ruft bei vorhandenem `document` das Rendering, sonst nur die Queue.

- [ ] **Step 1: Write the failing test file**

```js
// App/renderer/__tests__/toast.test.js
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { ToastQueue, showToast } = require('../toast');

beforeEach(() => { ToastQueue._messages = []; });

describe('ToastQueue', () => {
  it('push adds message with id and type', () => {
    const m = ToastQueue.push('Datei gespeichert', 'success');
    assert.strictEqual(m.message, 'Datei gespeichert');
    assert.strictEqual(m.type, 'success');
    assert.ok(typeof m.id === 'number');
  });
  it('peek returns first without removing', () => {
    ToastQueue.push('a');
    ToastQueue.push('b');
    assert.strictEqual(ToastQueue.peek().message, 'a');
    assert.strictEqual(ToastQueue._messages.length, 2);
  });
  it('pop removes and returns first', () => {
    ToastQueue.push('a');
    ToastQueue.push('b');
    assert.strictEqual(ToastQueue.pop().message, 'a');
    assert.strictEqual(ToastQueue._messages.length, 1);
  });
  it('peek returns null when empty', () => {
    assert.strictEqual(ToastQueue.peek(), null);
  });
});

describe('showToast', () => {
  it('enqueues message with default type', () => {
    showToast('Hallo');
    const m = ToastQueue.peek();
    assert.strictEqual(m.message, 'Hallo');
    assert.strictEqual(m.type, 'info');
  });
  it('respects explicit duration', () => {
    showToast('x', 'warn', 500);
    assert.strictEqual(ToastQueue.peek().duration, 500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test App/renderer/__tests__/toast.test.js`
Expected: FAIL with "Cannot find module '../toast'"

- [ ] **Step 3: Write the implementation**

```js
// App/renderer/toast.js
const ToastQueue = {
  _messages: [],

  push(message, type, duration) {
    const m = { id: Date.now() + Math.random(), message, type: type || 'info', duration: duration || 2500 };
    this._messages.push(m);
    return m;
  },

  peek() {
    return this._messages.length ? this._messages[0] : null;
  },

  pop() {
    return this._messages.shift() || null;
  }
};

function showToast(message, type, duration) {
  const m = ToastQueue.push(message, type, duration);
  if (typeof document !== 'undefined' && document.body) {
    renderToast(m);
  }
  return m;
}

function renderToast(m) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = 'toast toast-' + (m.type || 'info');
  el.textContent = m.message;
  container.appendChild(el);
  setTimeout(() => { el.classList.add('toast-hide'); setTimeout(() => el.remove(), 300); }, m.duration || 2500);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ToastQueue, showToast };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test App/renderer/__tests__/toast.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add App/renderer/toast.js App/renderer/__tests__/toast.test.js
git commit -m "feat: add toast queue and renderer"
```

---

### Task 2: `ui-level.js` — Level + Tour

**Files:**
- Create: `App/renderer/ui-level.js`
- Create: `App/renderer/__tests__/ui-level.test.js`

**Interfaces:**
- Produces: `UiLevel` mit `init()`, `setLevel('beginner'|'advanced')`, `getLevel()`, `isBeginner()`, `startTour()`, `onLevelChange`-Callback.
- `UiLevel._store` injizierbar (Default `window.localStorage`); Tour-Flag `florde-seen-onboarding`; Level-Key `florde-ui-level`.

- [ ] **Step 1: Write the failing test file**

```js
// App/renderer/__tests__/ui-level.test.js
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { UiLevel } = require('../ui-level');

function mockStore() {
  const data = {};
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    _data: data
  };
}

beforeEach(() => {
  UiLevel._store = mockStore();
  UiLevel.onLevelChange = null;
  UiLevel._toured = false;
});

describe('UiLevel', () => {
  it('defaults to beginner', () => {
    assert.strictEqual(UiLevel.getLevel(), 'beginner');
    assert.strictEqual(UiLevel.isBeginner(), true);
  });
  it('persists advanced', () => {
    UiLevel.setLevel('advanced');
    assert.strictEqual(UiLevel.getLevel(), 'advanced');
    assert.strictEqual(UiLevel._store.getItem('florde-ui-level'), 'advanced');
  });
  it('rejects invalid level', () => {
    UiLevel.setLevel('pro');
    assert.strictEqual(UiLevel.getLevel(), 'beginner');
  });
  it('reads stored level on first get', () => {
    UiLevel._store.setItem('florde-ui-level', 'advanced');
    assert.strictEqual(UiLevel.getLevel(), 'advanced');
  });
  it('fires onLevelChange', () => {
    let fired = null;
    UiLevel.onLevelChange = (l) => { fired = l; };
    UiLevel.setLevel('advanced');
    assert.strictEqual(fired, 'advanced');
  });
  it('startTour returns true only first time', () => {
    assert.strictEqual(UiLevel.startTour(), true);
    assert.strictEqual(UiLevel.startTour(), false);
    assert.strictEqual(UiLevel._store.getItem('florde-seen-onboarding'), '1');
  });
  it('startTour respects existing flag', () => {
    UiLevel._store.setItem('florde-seen-onboarding', '1');
    assert.strictEqual(UiLevel.startTour(), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test App/renderer/__tests__/ui-level.test.js`
Expected: FAIL with "Cannot find module '../ui-level'"

- [ ] **Step 3: Write the implementation**

```js
// App/renderer/ui-level.js
const UI_LEVEL_KEY = 'florde-ui-level';
const ONBOARDING_KEY = 'florde-seen-onboarding';

const UiLevel = {
  _store: (typeof window !== 'undefined' && window.localStorage) ? window.localStorage : null,
  _level: null,
  _toured: false,
  onLevelChange: null,

  getLevel() {
    if (this._level) return this._level;
    if (this._store) {
      const s = this._store.getItem(UI_LEVEL_KEY);
      if (s === 'advanced') return s;
    }
    return 'beginner';
  },

  isBeginner() {
    return this.getLevel() === 'beginner';
  },

  setLevel(level) {
    if (level !== 'beginner' && level !== 'advanced') return this.getLevel();
    this._level = level;
    if (this._store) this._store.setItem(UI_LEVEL_KEY, level);
    if (this.onLevelChange) this.onLevelChange(level);
    return level;
  },

  startTour() {
    if (this._toured) return false;
    if (this._store && this._store.getItem(ONBOARDING_KEY)) return false;
    this._toured = true;
    if (this._store) this._store.setItem(ONBOARDING_KEY, '1');
    if (this.onTourStart) this.onTourStart();
    return true;
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { UiLevel };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test App/renderer/__tests__/ui-level.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add App/renderer/ui-level.js App/renderer/__tests__/ui-level.test.js
git commit -m "feat: add UI level logic and first-run tour flag"
```

---

### Task 3: HTML — Onboarding-Modal + "⋮ Mehr"-Menü + Tooltips

**Files:**
- Modify: `App/renderer/index.html`

**Interfaces:**
- Produces: `#onboarding-modal` (`.modal.hidden`), `#btn-onboarding-skip`, `#btn-onboarding-next`, Schritte-Container `#onboarding-steps`; "⋮ Mehr"-Menü `#more-menu` mit Button `#btn-more` in der Titlebar; fehlende `title`-Attribute ergänzen.

- [ ] **Step 1: Add onboarding modal (nach `#florde-confirm-modal`, vor `<!-- Main App -->` Zeile 113)**

```html
<div id="onboarding-modal" class="modal hidden">
  <div class="modal-content" style="max-width:520px;">
    <h2>Willkommen bei Florde</h2>
    <div id="onboarding-steps">
      <div class="ob-step">
        <div style="font-size:1.6rem;">&#128194;</div>
        <p><strong>Projekt öffnen:</strong> Klick auf "Menu" &rarr; "Open Project", um einen Ordner zu öffnen.</p>
      </div>
      <div class="ob-step hidden">
        <div style="font-size:1.6rem;">&#9998;</div>
        <p><strong>Editieren:</strong> Wähle eine Datei links, bearbeite den Code. Markiere Text, um die KI-Aktionen (Verbessern, Ändern…) zu sehen.</p>
      </div>
      <div class="ob-step hidden">
        <div style="font-size:1.6rem;">&#128172;</div>
        <p><strong>Chat:</strong> Frag die Florde-AI im Chat-Panel. Tippe <code>/help</code> für alle Befehle.</p>
      </div>
      <div class="ob-step hidden">
        <div style="font-size:1.6rem;">&#9881;</div>
        <p><strong>Erweitert:</strong> In den Einstellungen kannst du später auf den "Erweitert"-Modus mit allen Funktionen umschalten.</p>
      </div>
    </div>
    <div class="modal-actions" style="justify-content:space-between;">
      <button id="btn-onboarding-skip" class="btn btn-secondary">Überspringen</button>
      <button id="btn-onboarding-next" class="btn btn-primary">Weiter</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add "⋮ Mehr"-Button + Menü in Titlebar**

In `App/renderer/index.html` innerhalb `<div class="titlebar-center">` (nach Zeile 149, `#btn-toggle-diff`):

```html
<div class="more-menu-wrapper">
  <button id="btn-more" title="Mehr" class="hidden">&#8943;</button>
  <div id="more-menu" class="more-menu hidden">
    <button id="btn-more-audit" class="more-menu-item" title="Audit Log">&#128196; Audit Log</button>
    <button id="btn-more-docker" class="more-menu-item" title="Docker Panel">&#128051; Docker</button>
    <button id="btn-more-dev" class="more-menu-item" title="Dev Utilities">&#128736; Dev Utilities</button>
    <button id="btn-more-ci" class="more-menu-item" title="Code Intelligence">&#129302; Code Intelligence</button>
  </div>
</div>
```

> Die Buttons `btn-more-audit` usw. sind **Klon-Alternativen**: In `script.js` werden sie per `cloneNode` der Original-Buttons ersetzt oder per Click-Weiterleitung `document.getElementById('btn-audit-log').click()` gebunden. Konkret (Step 3): Weiterleitungs-Binding in script.js.

- [ ] **Step 3: Fehlende Tooltips ergänzen (bestehende Buttons)**

Sicherstellen, dass folgende Buttons in `index.html` ein `title`-Attribut haben: `btn-save-all` ("Save All (Ctrl+S)"), `btn-back-menu` ("Zurück zum Startmenü"), `btn-theme-toggle` ("Theme umschalten"), `btn-fullscreen` ("Vollbild (F11)"), `btn-export-zip` ("Export als ZIP"), `btn-ci-toggle` ("Code Intelligence"), `btn-management-toggle` ("Management").

- [ ] **Step 4: Add script tag before `script.js`**

```html
<script src="toast.js"></script>
<script src="ui-level.js"></script>
```

- [ ] **Step 5: Commit**

```bash
git add App/renderer/index.html
git commit -m "feat: add onboarding modal, more menu and tooltips"
```

---

### Task 4: CSS — Level-Steuerung, Toast, Onboarding, More-Menü

**Files:**
- Modify: `App/renderer/style.css` (append)

- [ ] **Step 1: Styles**

```css
/* ===== UI Level ===== */
body.ui-level-advanced #btn-more,
body.ui-level-advanced .more-menu-wrapper { display: none !important; }

body.ui-level-beginner #btn-more { display: inline-flex; }
body.ui-level-beginner .titlebar-center > button:not(#btn-more):not(#btn-search-toggle):not(#btn-terminal-toggle):not(#btn-browser-toggle):not(#btn-git-toggle):not(#btn-theme-toggle):not(#btn-fullscreen):not(#btn-export-zip):not(#btn-management-toggle):not(#btn-settings) { display: none; }

.more-menu {
  position: absolute; right: 0; top: 100%; z-index: 10004;
  background: var(--bg2); border: 1px solid var(--border); border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4); padding: 4px; min-width: 180px;
}
.more-menu-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  background: transparent; border: none; color: var(--text1); text-align: left;
  padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 0.8rem;
}
.more-menu-item:hover { background: var(--bg3); }
.more-menu-wrapper { position: relative; display: inline-flex; }

/* ===== Toasts ===== */
#toast-container {
  position: fixed; bottom: 16px; right: 16px; z-index: 10060;
  display: flex; flex-direction: column; gap: 8px; pointer-events: none;
}
.toast {
  background: var(--bg2); border: 1px solid var(--border); border-left: 4px solid var(--accent1);
  color: var(--text1); font-size: 0.8rem; padding: 10px 14px; border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.4); transition: opacity .3s, transform .3s;
}
.toast-success { border-left-color: #22c55e; }
.toast-warn { border-left-color: #f59e0b; }
.toast-error { border-left-color: #ef4444; }
.toast-hide { opacity: 0; transform: translateX(10px); }

/* ===== Onboarding ===== */
.ob-step { text-align: center; padding: 8px 0; }
.ob-step p { font-size: 0.9rem; line-height: 1.6; color: var(--text2); }
```

- [ ] **Step 2: Commit**

```bash
git add App/renderer/style.css
git commit -m "feat: add UI level, toast and onboarding styles"
```

---

### Task 5: `script.js` — Init + More-Menü-Binding + Toast-Ersetzungen

**Files:**
- Modify: `App/renderer/script.js`

**Interfaces:**
- Consumes: `UiLevel`, `showToast` (Globals via script-tag)
- Produces: `applyUiLevel(level)` (body-Klassen); More-Menü Toggle + Weiterleitung; `showToast`-Ersetzung für Kern-Erfolgsaktionen; Tour-Start nach App-Start.

- [ ] **Step 1: Add level application + tour trigger (am Ende, nach Init)**

```js
function applyUiLevel(level) {
  document.body.classList.toggle('ui-level-beginner', level === 'beginner');
  document.body.classList.toggle('ui-level-advanced', level === 'advanced');
}
UiLevel.onLevelChange = applyUiLevel;
applyUiLevel(UiLevel.getLevel());

document.getElementById('btn-more')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const m = document.getElementById('more-menu');
  m?.classList.toggle('hidden');
});
document.addEventListener('click', () => document.getElementById('more-menu')?.classList.add('hidden'));
const moreMap = {
  'btn-more-audit': 'btn-audit-log',
  'btn-more-docker': 'btn-docker-toggle',
  'btn-more-dev': 'btn-dev-utils',
  'btn-more-ci': 'btn-ci-toggle'
};
for (const [moreBtn, origBtn] of Object.entries(moreMap)) {
  document.getElementById(moreBtn)?.addEventListener('click', () => document.getElementById(origBtn)?.click());
}
```

- [ ] **Step 2: Add onboarding wiring**

```js
function showOnboarding() {
  const modal = document.getElementById('onboarding-modal');
  if (!modal) return;
  const steps = modal.querySelectorAll('.ob-step');
  let idx = 0;
  modal.classList.remove('hidden');
  const render = () => {
    steps.forEach((s, i) => s.classList.toggle('hidden', i !== idx));
    const next = document.getElementById('btn-onboarding-next');
    if (next) next.textContent = idx === steps.length - 1 ? 'Los geht\'s' : 'Weiter';
  };
  document.getElementById('btn-onboarding-next')?.addEventListener('click', () => {
    idx++;
    if (idx >= steps.length) { modal.classList.add('hidden'); return; }
    render();
  });
  document.getElementById('btn-onboarding-skip')?.addEventListener('click', () => modal.classList.add('hidden'));
  render();
}
UiLevel.onTourStart = showOnboarding;
if (UiLevel.startTour()) showOnboarding();
```

- [ ] **Step 3: Toast-Ersetzungen für Kern-Aktionen**

Im Einsteiger-Modus Kern-Erfolgsmeldungen ergänzen (ohne `logToTerminal` zu ersetzen). Beispielhafte Stelle nach `saveCurrentFile`-Erfolg bzw. nach Inline-Diff-Commit:

```js
if (UiLevel.isBeginner()) showToast('Datei gespeichert', 'success');
```

> Konkret wird je eine `showToast`-Zeile an die bestehenden Erfolgspfade gesetzt (Save-All, Diff-Commit, Export-ZIP). Die genaue Stelle richtet sich nach den vorhandenen Erfolgs-Log-Aufrufen in `script.js` (`logToTerminal(..., 'success')`).

- [ ] **Step 4: Run tests**

Run: `node --test App/renderer/__tests__/toast.test.js App/renderer/__tests__/ui-level.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add App/renderer/script.js
git commit -m "feat: wire UI level, onboarding, more menu and toasts"
```

---

### Task 6: Abschluss-Verifikation

- [ ] **Step 1: Alle Tests**

Run: `node --test App/renderer/__tests__/ App/sandbox/__tests__/`
Expected: PASS

- [ ] **Step 2: Manueller Smoke-Test**

- Erster Start (neues Profil / gelöschtes `florde-seen-onboarding`) → Onboarding-Dialog mit 4 Schritten, "Überspringen" funktioniert.
- Einsteiger-Modus (Standard): Titlebar zeigt Kern-Buttons + "⋮"; erweiterte Buttons nur im Menü.
- Speichern einer Datei → Toast "Datei gespeichert" unten rechts.
- In Einstellungen auf "Erweitert" → Titlebar zeigt alle Buttons; "⋮" verschwindet.
- Neustart → Level bleibt (localStorage), kein Onboarding mehr.

- [ ] **Step 3: Final Commit (falls nötig)**

```bash
git add -A
git commit -m "feat: complete beginner UI"
```

---

## Self-Review-Checkliste (nach Ausführung)

1. **Spec-Abdeckung:** First-Run-Tour (Task 3/5), "⋮ Mehr"-Menü (Task 3/4/5), fehlende Tooltips (Task 3 Step 3), Sidebar-Gruppierung/Einklappbarkeit via `body.ui-level-beginner` (Task 4), Toasts (Task 1/5), Level-Persistenz (Task 2).
2. **Placeholder-Scan:** Keine "TBD". Ein markierter Flexibilitätspunkt: exakte Toast-Einfügestellen in Task 5 Step 3 (referenziert bestehende Erfolgspfade).
3. **Typ-Konsistenz:** `UiLevel.getLevel/setLevel/isBeginner/startTour/onLevelChange/onTourStart` konsistent in Task 2/5; `showToast(message,type,duration)` und `ToastQueue.push/peek/pop` konsistent in Task 1/5.
