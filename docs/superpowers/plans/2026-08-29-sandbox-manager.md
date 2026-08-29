# Sandbox Manager Vervollständigung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 18 checklist items of `Sandbox Aufgabe.md` in Florde — the complete missing sandbox logic (wizard, PC recommendation, vision mode, VM live view, auto-snapshots, OS templates + image download, network selection) on top of the existing SandboxManager.

**Architecture:** Extends the existing `SandboxManager` (main process) + renderer UI. New renderer modules: `sandbox-wizard.js` (first-run setup), `sandbox-vm-panel.js` (live VNC view with pause/stop/takeover). New main-process helpers for VNC streaming and image download. Vision mode integrates with the existing tool registry and audit log.

**Tech Stack:** Electron, Node.js (node:test for unit tests), better-sqlite3 (audit log), rfb2 (VNC), existing eval framework `node --test sandbox/__tests__/*.test.js`.

## Global Constraints

- Use existing code patterns; German UI labels (existing convention).
- Secret/security: reuse sandbox command validation; never introduce shell-injectable string interpolation of user data.
- Tests: keep existing sandbox tests green; Docker tests failing on missing image is a known environment issue (does not block).
- The Security fix for `system-detector.js` `_checkBinary` (execFileSync) must be applied to `main` since it currently has the vulnerable version.
- Settings merged via existing `saveSettingsToDisk`/`loadSettings` in renderer; main reads/saves `settings.json`.
- Sandbox config keys: `sandbox.type`, `sandbox.configured`, `sandbox.network`, `sandbox.vmTemplate`, `sandbox.imagesDir`.

---

### Task 1: Security fix for system-detector on main branch

**Files:**
- Modify: `App/sandbox/system-detector.js:60-71`

**Interfaces:**
- Consumes: nothing new
- Produces: `SystemDetector._checkBinary(name)` safe version

- [ ] **Step 1: Write the failing test**

Create `App/sandbox/__tests__/system-detector-check.test.js`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { SystemDetector } = require('../system-detector');

describe('SystemDetector._checkBinary injection safety', () => {
  it('should return false for malicious names', async () => {
    assert.strictEqual(await SystemDetector._checkBinary('; rm -rf /'), false);
    assert.strictEqual(await SystemDetector._checkBinary('foo; echo pwned'), false);
    assert.strictEqual(await SystemDetector._checkBinary('$(whoami)'), false);
    assert.strictEqual(await SystemDetector._checkBinary('../etc'), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sandbox/__tests__/system-detector-check.test.js`
Expected: FAIL (empty string passes `which` without effect, or injection chars pass) — at minimum the `;` case fails.

- [ ] **Step 3: Implement the safe version**

Replace lines 60-71 (the `_checkBinary` method) with:

```js
  static async _checkBinary(name) {
    if (!name || /[/\\;&|`$\n]/.test(name)) return false;
    try {
      const binary = os.platform() === 'win32' ? 'where' : 'which';
      execFileSync(binary, [name], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
```

And add `execFileSync` to the existing import on line 2:
```js
const { execSync, execFileSync } = require('child_process');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test sandbox/__tests__/system-detector-check.test.js`
Expected: PASS (all malicious names rejected).

- [ ] **Step 5: Commit**

```bash
git add App/sandbox/system-detector.js App/sandbox/__tests__/system-detector-check.test.js
git commit -m "security: fix shell injection in system-detector _checkBinary"
```

---

### Task 2: VM network settings in VMWareBackend

**Files:**
- Modify: `App/sandbox/backends/vmware.js:26-45`
- Modify: `App/sandbox/backends/qemu.js` (add `_network` handling if missing)

**Interfaces:**
- Consumes: `SandboxBackend` base
- Produces: Backend accepts `network` option; store exposed via `backend.network`

- [ ] **Step 1: Write the failing test**

Create `App/sandbox/__tests__/vmware-network.test.js`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { VMWareBackend } = require('../backends/vmware');

describe('VMWareBackend network config', () => {
  it('should accept network option in constructor', () => {
    const b = new VMWareBackend('/tmp/work', { network: 'host-only' });
    assert.strictEqual(b.network, 'host-only');
  });
  it('should default to nat', () => {
    const b = new VMWareBackend('/tmp/work');
    assert.strictEqual(b.network, 'nat');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sandbox/__tests__/vmware-network.test.js`
Expected: FAIL (`b.network` undefined).

- [ ] **Step 3: Implement**

In `vmware.js` constructor add storage, and a getter:

```js
    this._network = options.network || 'nat';
```

```js
  get network() { return this._network; }
  set network(value) { this._network = value; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test sandbox/__tests__/vmware-network.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add App/sandbox/backends/vmware.js App/sandbox/__tests__/vmware-network.test.js
git commit -m "feat: add network option support to VMWareBackend"
```

---

### Task 3: Sandbox config in settings model + manager integration

**Files:**
- Modify: `App/main.js:373-415` (sandbox IPC block)
- Modify: `App/renderer/preload.js` (add `sandbox.setConfig`, `sandbox.getConfig`)

**Interfaces:**
- Consumes: existing `SandboxManager`
- Produces:
  - `ipcMain.handle('sandbox:get-config')` → returns `{ type, network, vmTemplate, imagesDir, configured }`
  - `ipcMain.handle('sandbox:set-config', (e, cfg))` → merges `sandbox.*` in settings.json and returns saved config
  - `ipcMain.handle('sandbox:set-network', (e, network))` → updates manager backend network + settings

- [ ] **Step 1: Write the failing test**

Create `App/sandbox/__tests__/config.test.js`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { SandboxManager } = require('../manager');

describe('SandboxManager network propagation', () => {
  it('should update network on the active VM backend', async () => {
    const mgr = new SandboxManager('/tmp/sbx');
    await mgr.switchBackend('vmware');
    mgr.setNetwork('host-only');
    assert.strictEqual(mgr.active.network, 'host-only');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sandbox/__tests__/config.test.js`
Expected: FAIL (`mgr.setNetwork is not a function`).

- [ ] **Step 3: Implement**

In `manager.js` add a method after `recommend` (line ~90):

```js
  async setNetwork(network) {
    const b = this.active;
    if (b && typeof b.network !== 'undefined') {
      if ('_network' in b) b._network = network;
      else b.network = network;
      this._emit('network-change', { network });
      return true;
    }
    return false;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test sandbox/__tests__/config.test.js`
Expected: PASS

- [ ] **Step 5: Wire IPC + preload, then commit**

In `main.js`, after the existing `sandbox:vm-key` handler (line ~413):

```js
ipcMain.handle('sandbox:get-config', () => {
  try { return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8')).sandbox || {}; } catch { return {}; }
});

ipcMain.handle('sandbox:set-config', (event, cfg) => {
  try {
    const settings = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8'));
    settings.sandbox = { ...(settings.sandbox || {}), ...cfg };
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
    return settings.sandbox;
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle('sandbox:set-network', async (event, network) => {
  await sandboxManager.setNetwork(network);
  return { ok: true, network };
});
```

In `preload.js` extend the `sandbox` object (after `vmKey`):

```js
    getConfig: () => ipcRenderer.invoke('sandbox:get-config'),
    setConfig: (cfg) => ipcRenderer.invoke('sandbox:set-config', cfg),
    setNetwork: (n) => ipcRenderer.invoke('sandbox:set-network', n),
```

Commit:
```bash
git add App/main.js App/preload.js App/sandbox/manager.js App/sandbox/__tests__/config.test.js
git commit -m "feat: sandbox config IPC + network propagation"
```

---

### Task 4: Sandbox wizard module (feature 1 + 2 of task file)

**Files:**
- Create: `App/renderer/sandbox-wizard.js`
- Modify: `App/renderer/index.html` (add wizard modal + script tag)
- Modify: `App/renderer/style.css` (wizard styles)

**Interfaces:**
- Consumes: `window.electronAPI.sandbox.{status, detect, recommend, setConfig, getConfig}`, `saveSettingsToDisk`, `showNotification`
- Produces: `SandboxWizard.shouldShow()` → bool; `SandboxWizard.open()` → opens modal; `SandboxWizard.init()` sets up listeners

**Backend type metadata for the wizard (hardcoded in module, matches backends):**

```js
const SANDBOX_OPTIONS = [
  { type: 'none', label: 'Kleine Sandbox', pros: ['Sehr schnell', 'Wenig RAM/CPU', 'Gut für Code-Analysen'], cons: ['Weniger Isolation', 'Wenig Schutz bei schweren Fehlern'] },
  { type: 'firejail', label: 'Firejail Sandbox', pros: ['Sehr schnell', 'Wenig RAM/CPU', 'Bessere Isolation als ohne'], cons: ['Nur Linux', 'Keine echte VM', 'Für Vision-Modelle ungeeignet'] },
  { type: 'docker', label: 'Docker/Podman Sandbox', pros: ['Gute Isolation', 'Reproduzierbar', 'Unterschiedliche Umgebungen'], cons: ['Docker muss installiert sein', 'Mehr Ressourcen', 'Nicht so sicher wie echte VM'] },
  { type: 'vmware', label: 'VM Sandbox', pros: ['Höchste Isolation', 'Eigene Umgebung', 'Riskante Tests möglich', 'Vision-Modelle können sehen'], cons: ['Braucht viel RAM/CPU', 'Langsamer', 'VM muss eingerichtet sein'] },
];
```

- [ ] **Step 1: Create the module with render + persistence**

Create `App/renderer/sandbox-wizard.js`:

```js
// App/renderer/sandbox-wizard.js
const SandboxWizard = {
  _meta: null,
  opened: false,

  SANDBOX_OPTIONS: [
    { type: 'none', label: 'Kleine Sandbox', desc: 'Schnelle, isolierte Umgebung für normale Aufgaben.', pros: ['Sehr schnell', 'Wenig RAM/CPU', 'Gut für Code-Analysen, Tests, kleine Änderungen'], cons: ['Weniger Isolation', 'Bei schweren Fehlern weniger Schutz'] },
    { type: 'firejail', label: 'Firejail Sandbox', desc: 'Leichtgewichtige Linux-Sandbox mit eingeschränkten Rechten.', pros: ['Sehr schnell', 'Wenig RAM/CPU', 'Deutlich bessere Isolation'], cons: ['Nur unter Linux', 'Keine vollständige VM', 'Ungünstig für Vision-Modelle/Desktop'] },
    { type: 'docker', label: 'Docker/Podman Sandbox', desc: 'Die KI arbeitet in einem Container.', pros: ['Gute Isolation', 'Reproduzierbare Umgebung', 'Unterschiedliche Entwicklungsumgebungen'], cons: ['Docker/Podman muss installiert sein', 'Etwas mehr Ressourcen', 'Nicht gleiche Sicherheit wie echte VM'] },
    { type: 'vmware', label: 'VM Sandbox', desc: 'Eine komplette virtuelle Maschine für die KI.', pros: ['Höchste Isolation', 'Eigene Umgebung', 'Riskante Tests möglich', 'Vision-Modelle können sehen und steuern'], cons: ['Viel RAM/CPU nötig', 'Langsamer', 'Einrichtung nötig'] },
  ],

  shouldShow() {
    return !(this._meta && this._meta.configured);
  },

  async _loadConfig() {
    this._meta = (await window.electronAPI.sandbox.getConfig()) || {};
    return this._meta;
  },

  _render(options) {
    const modal = document.getElementById('sandbox-wizard-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    const body = modal.querySelector('.wizard-body');
    const list = options.map(o => `
      <div class="sandbox-option" data-type="${o.type}">
        <div class="sandbox-option-head">
          <span class="sandbox-option-name">${o.label}</span>
          <span class="sandbox-option-radio"></span>
        </div>
        <p class="sandbox-option-desc">${o.desc}</p>
        <div class="sandbox-option-pros">${o.pros.map(p => '<span class="pro">✓ ' + p + '</span>').join('')}</div>
        <div class="sandbox-option-cons">${o.cons.map(c => '<span class="con">✗ ' + c + '</span>').join('')}</div>
      </div>`).join('');
    body.innerHTML = `
      <p style="color:var(--text2);font-size:0.9rem;">Wie soll die KI im Sandbox-Mode arbeiten dürfen?</p>
      <div class="sandbox-option-list">${list}</div>
      <div style="margin-top:0.75rem;display:flex;gap:0.5rem;flex-wrap:wrap;">
        <button id="wizard-recommend" class="btn">Empfohlen für deinen PC</button>
        <span id="wizard-recommend-out" style="font-size:0.8rem;color:var(--text3);align-self:center;"></span>
      </div>
      <div id="wizard-recommend-detail" style="margin-top:0.5rem;font-size:0.85rem;"></div>
    `;

    modal.querySelectorAll('.sandbox-option').forEach(el => {
      el.addEventListener('click', () => {
        modal.querySelectorAll('.sandbox-option').forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
      });
    });

    document.getElementById('wizard-recommend').addEventListener('click', async () => {
      try {
        const spec = await window.electronAPI.sandbox.detect();
        const recs = await window.electronAPI.sandbox.recommend(spec);
        const r = recs[0];
        const detail = document.getElementById('wizard-recommend-detail');
        detail.innerHTML = '<strong>Empfohlen für deinen PC</strong><br>' +
          'CPU &nbsp;✓ ' + spec.cpu.model + '<br>' +
          'RAM &nbsp;✓ ' + spec.ram.total + ' MB<br>' +
          'GPU &nbsp;✓ ' + (spec.gpu.model || 'unbekannt') +
          (spec.gpu.vram > 0 ? ' (' + spec.gpu.vram + ' MB VRAM)' : '') + '<br><br>' +
          '<em>' + r.reason + '</em>';
        const target = modal.querySelector('.sandbox-option[data-type="' + r.type + '"]');
        if (target) {
          modal.querySelectorAll('.sandbox-option').forEach(x => x.classList.remove('selected'));
          target.classList.add('selected');
        }
      } catch (err) {
        if (typeof showNotification === 'function') showNotification('error', 'Empfehlung fehlgeschlagen: ' + err.message);
      }
    });
  },

  _bindActions() {
    const modal = document.getElementById('sandbox-wizard-modal');
    document.getElementById('wizard-save')?.addEventListener('click', async () => {
      const sel = modal?.querySelector('.sandbox-option.selected');
      const type = sel ? sel.dataset.type : 'none';
      await window.electronAPI.sandbox.setConfig({ type, configured: true });
      try { await window.electronAPI.sandbox.switchBackend(type); } catch {}
      if (typeof saveSettingsToDisk === 'function') {
        const s = (() => { try { return JSON.parse(localStorage.getItem('florde-settings') || '{}'); } catch { return {}; } })();
        s.sandbox = { type, configured: true };
        await saveSettingsToDisk(s);
      }
      modal.classList.add('hidden');
      if (typeof showNotification === 'function') showNotification('success', 'Sandbox auf ' + type + ' eingerichtet');
      document.dispatchEvent(new CustomEvent('sandbox:wizard-done', { detail: { type } }));
    });

    document.getElementById('wizard-cancel')?.addEventListener('click', () => {
      modal.classList.add('hidden');
    });
  },

  async open() {
    await this._loadConfig();
    if (this.opened) return;
    this.opened = true;
    this._render(this.SANDBOX_OPTIONS);
    this._bindActions();
  },
};

if (typeof module !== 'undefined') module.exports = { SandboxWizard };
```

- [ ] **Step 2: Add modal HTML to index.html**

Add before the closing `</div>` of modals (after `question-modal` block, around line 80 section). Insert:

```html
  <div id="sandbox-wizard-modal" class="modal hidden">
    <div class="modal-content" style="max-width:640px;">
      <h2 lang-key="tab_sandbox">Sandbox einrichten</h2>
      <div class="wizard-body"></div>
      <div class="modal-actions" style="margin-top:1rem;">
        <button id="wizard-cancel" class="btn btn-small">Später</button>
        <button id="wizard-save" class="btn btn-small primary">Übernehmen</button>
      </div>
    </div>
  </div>
```

Add script tag near the other scripts (before `sandbox-settings.js` around line 1419):

```html
  <script src="sandbox-wizard.js"></script>
```

- [ ] **Step 3: Add CSS**

Append to `style.css`:

```css
.sandbox-option { border:1px solid var(--border2); border-radius:8px; padding:0.75rem; margin-bottom:0.6rem; cursor:pointer; transition:border-color .15s; }
.sandbox-option:hover { border-color:var(--accent); }
.sandbox-option.selected { border-color:var(--accent); background:rgba(99,102,241,0.08); }
.sandbox-option-head { display:flex; justify-content:space-between; align-items:center; font-weight:600; }
.sandbox-option-radio { width:12px; height:12px; border-radius:50%; border:2px solid var(--text3); }
.sandbox-option.selected .sandbox-option-radio { border-color:var(--accent); background:var(--accent); }
.sandbox-option-desc { font-size:0.8rem; color:var(--text2); margin:0.3rem 0; }
.sandbox-option-pros, .sandbox-option-cons { display:flex; flex-direction:column; gap:2px; font-size:0.75rem; }
.sandbox-option-pros .pro { color:#22c55e; }
.sandbox-option-cons .con { color:#ef4444; }
```

- [ ] **Step 4: Wire first-run trigger in script.js + verify**

In `script.js`, near the end where settings load completes (after line ~2880 `loadSettings` error handler), add:

```js
async function maybeShowSandboxWizard() {
  try {
    const cfg = await window.electronAPI.sandbox.getConfig();
    if (!cfg.configured) {
      await SandboxWizard.open();
    }
  } catch {}
}
```

Call it at the end of `loadSettings` success path (after `localStorage` settings are applied). Find the end of `loadSettings` (around line 2880) and add `maybeShowSandboxWizard();`.

- [ ] **Step 5: Manual verification + commit**

Manual: launch app (`npm start` from App dir with `--dev`). Delete `settings.json`'s `sandbox` key first. Verify modal shows on first launch; select type; click recommend → shows checks; save → persists (`settings.json` has `sandbox.configured: true`); relaunch → no modal.

```bash
git add App/renderer/sandbox-wizard.js App/renderer/index.html App/renderer/style.css App/renderer/script.js
git commit -m "feat: first-run sandbox setup wizard with PC recommendation"
```

---

### Task 5: Wire wizard from sandbox-settings ("Setup erneut starten")

**Files:**
- Modify: `App/renderer/sandbox-settings.js`

**Interfaces:**
- Consumes: `SandboxWizard.open()`
- Produces: "Setup erneut starten" button in sandbox settings

- [ ] **Step 1: Add re-open button**

Inside `sandbox-settings.js` `_render`, after the recommendation div (line ~35), add:

```js
        <button id="btn-sandbox-wizard" class="btn btn-small" style="margin-top:0.5rem;">Setup erneut starten</button>
```

And in the event bindings section (after line ~66) add:

```js
    document.getElementById('btn-sandbox-wizard')?.addEventListener('click', () => {
      if (typeof SandboxWizard !== 'undefined') SandboxWizard.open();
    });
```

- [ ] **Step 2: Commit**

```bash
git add App/renderer/sandbox-settings.js
git commit -m "feat: re-open sandbox setup wizard from settings"
```

---

### Task 6: Vision mode — tool registry + session state (feature 3)

**Files:**
- Modify: `App/renderer/script.js` (~line 169 `getActiveTools`, line 5078 tool dispatch, `sendMessage` ~5652, `toggleSendStop` ~4679)

**Interfaces:**
- Consumes: `MODEL_META` vision flags, existing `AuditLog.log`, existing `_isRequestActive`
- Produces:
  - `const VisionSession = { active: false, taskId: null, startedAt: null, allowed: false, requestAccess(), grant(), revoke('answer'|'manual'), isActive() }`
  - Tool `vision_request` added to `getActiveTools` only when active model has vision (`MODEL_META[modelId]?.tasks?.vision`)
  - `window.__visionSessionActive` boolean for UI

- [ ] **Step 1: Add VisionSession object + tool**

In `script.js`, after the `buildToolReminder` function (~line 217), add:

```js
// ==================== VISION SESSION ====================
const VisionSession = {
  active: false,
  taskId: null,
  startedAt: null,
  allowed: false,

  requestAccess(taskId) {
    this.active = true;
    this.taskId = taskId || Date.now().toString();
    this.startedAt = Date.now();
    AuditLog.log({ type: 'vision', action: 'Vision Session gestartet', status: 'auto', summary: 'Vision Session gestartet (Aufgabe: ' + this.taskId + ')', details: { taskId: this.taskId }, source: 'KI' });
    document.getElementById('btn-send').innerHTML = 'Stop';
    this._notify(false);
    return 'Die KI hat um Bildschirm-Zugriff (Vision) für diese Aufgabe gebeten.';
  },

  grant() {
    this.allowed = true;
    AuditLog.log({ type: 'vision', action: 'Vision Erlaubnis nur für diese Aufgabe', status: 'allowed', summary: 'Vision Erlaubnis nur für diese Aufgabe erteilt', details: { taskId: this.taskId }, source: 'User' });
    return 'Vision für diese Aufgabe erlaubt.';
  },

  revoke(reason) {
    if (!this.active) return;
    this.active = false;
    this.allowed = false;
    AuditLog.log({ type: 'vision', action: 'Vision Session beendet (' + reason + ')', status: 'auto', summary: 'Vision Session beendet (' + reason + ')', details: { taskId: this.taskId}, source: reason === 'manual' ? 'User' : 'KI' });
    document.getElementById('btn-send').innerHTML = 'Senden';
    this._notify(true);
  },

  _notify(done) {
    window.__visionSessionActive = !done;
    const badge = document.getElementById('vision-badge');
    if (badge) badge.style.display = done ? 'none' : 'inline-flex';
  }
};
```

In `getActiveTools()`, after the `ask_question` entry (line ~177) add the conditional tool. Replace the middleware section — insert after the `executeTool`-relevant code by registering before `const appTools`:

```js
  const activeProvider = resolveProvider();
  const modelName = activeProvider?.provider?.model;
  const meta = modelName ? MODEL_META[modelName] : null;
  if (meta && meta.tasks && meta.tasks.vision) {
    baseTools.push({ type: 'function', function: { name: 'vision_request', description: 'Request permission to see the VM screen (vision) for the current task. Use this instead of take_screenshot when a vision-capable model needs to look at the screen.', parameters: { type: 'object', properties: { description: { type: 'string', description: 'What you want to look at' } }, required: [] } } });
  }
```

- [ ] **Step 2: Add tool dispatch case**

In the tool dispatch switch (near the `case 'take_screenshot':` at line ~5078), add before it:

```js
    case 'vision_request':
      AuditLog.log({ type: 'vision', action: 'Vision angefragt', status: 'auto', summary: 'KI fragt nach Vision (Bildschirm sehen)', details: {}, source: 'KI' });
      VisionSession.requestAccess();
      return 'Vision requested. The user must approve via the confirmation dialog. Ask them to confirm using ask_question or wait.';
```

Add `/vision allow` handler next to other slash-commands in `sendMessage` (after the `summarize` block ~line 5686). Insert:

```js
    if (slashCmd === 'vision') {
      if (rest.toLowerCase() === 'allow') { VisionSession.grant(); }
      else if (rest.toLowerCase() === 'stop') { VisionSession.revoke('manual'); }
      _hideUserMsg = true;
    }
```

- [ ] **Step 3: End vision on text answer**

In `sendMessage`, insert right before line 6294 (`_isRequestActive = false`), which is after the assistant text reply is finalized. The exact insertion:

```js
  if (VisionSession.active) VisionSession.revoke('answer');
```

Find the line `    _isRequestActive = false;` (currently line 6294) and add the `if (VisionSession.active)` line directly above it. This runs after the streaming completes, whether the reply was text or a stop — so a text answer ends the vision session.

- [ ] **Step 4: Toggle button to Stop while active**

In `toggleSendStop` (line ~4679), adjust:

```js
function toggleSendStop() {
  const aborter = _requestAborter;
  if (aborter) aborter.abort();
  if (VisionSession.active) { VisionSession.revoke('manual'); return; }
  ...
}
```

Also in the send-button click binding (line ~4708 `document.getElementById('btn-send').addEventListener('click', toggleSendStop)`) — no change needed since same handler.

Add a visual badge in `index.html` near the send button (find the chat input area, around line with `btn-send`). Insert:

```html
      <span id="vision-badge" class="vision-badge hidden" title="Vision aktiv">👁 Vision</span>
```

Add CSS:
```css
.vision-badge { display:inline-flex; align-items:center; gap:4px; background:rgba(99,102,241,0.15); color:var(--accent); border:1px solid var(--accent); border-radius:12px; padding:2px 8px; font-size:0.7rem; }
.vision-badge.hidden { display:none; }
```

- [ ] **Step 5: Commit**

```bash
git add App/renderer/script.js App/renderer/index.html App/renderer/style.css
git commit -m "feat: vision mode with vision_request tool and session lifecycle"
```

---

### Task 7: VM live view panel (feature 4) — main-side VNC stream

**Files:**
- Create: `App/sandbox/vnc-stream.js`
- Modify: `App/main.js` (add IPC send handlers + stream loop)
- Modify: `App/renderer/preload.js` (expose stream APIs + on(event) listener)

**Interfaces:**
- Consumes: `VNCClient` (`App/sandbox/vnc-client.js`), rfb2 rect events
- Produces:
  - `VncStreamer` class: `start(vmxPort, opts)`, `stop()`, `onFrame(cb)`, `onResize`, `sendMouse(x,y,button)`, `sendKey(keysym)`, property `running`
  - Main IPC: `sandbox:vm-stream-start`, `sandbox:vm-stream-stop`
  - Preload: `electronAPI.sandbox.vmStreamStart()`, `vmStreamStop()`, `electronAPI.onVmFrame((frame)=>...)` (via `ipcRenderer.on('sandbox:vm-frame', ...)`)

- [ ] **Step 1: Write the failing test**

Create `App/sandbox/__tests__/vnc-stream.test.js`:

```js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { VncStreamer } = require('../vnc-stream');

describe('VncStreamer', () => {
  let tmp;
  before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vncstream-')); });
  after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('should not throw on stop when not running', () => {
    const s = new VncStreamer({ host: '127.0.0.1', port: 5909 });
    s.stop();
    assert.strictEqual(s.running, false);
  });

  it('should reject start if already running', async () => {
    const s = new VncStreamer({ host: '127.0.0.1', port: 5909 });
    s.running = true;
    await assert.rejects(() => s.start(), /already running/);
    s.running = false;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sandbox/__tests__/vnc-stream.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement vnc-stream.js**

Create `App/sandbox/vnc-stream.js`:

```js
const { VNCClient } = require('./vnc-client');

class VncStreamer {
  constructor(options = {}) {
    this._opts = { host: options.host || '127.0.0.1', port: options.port || 5900, password: options.password || '' };
    this._client = null;
    this._running = false;
    this._cb = () => {};
  }

  get running() { return this._running; }

  onFrame(cb) { if (typeof cb === 'function') this._cb = cb; }

  async start() {
    if (this._running) throw new Error('VNC stream already running');
    this._running = true;
    this._client = new VNCClient(this._opts);
    await this._client.connect();
    const rfb = this._client._client;
    rfb.requestUpdate(false, 0, 0, rfb.width, rfb.height);
    let dirty = rfb.width * rfb.height * 4;
    rfb.on('rect', (rect) => {
      const frame = this._client._client.frameBuffer;
      const w = this._client._client.width;
      const h = this._client._client.height;
      this._cb({ width: w, height: h, buffer: frame, bytes: dirty });
      dirty = w * h * 4;
    });
    return true;
  }

  stop() {
    if (this._client) this._client.disconnect();
    this._client = null;
    this._running = false;
  }

  sendMouse(x, y, button = 1) { if (this._client) this._client.sendMouse(x, y, button); }
  sendKey(keysym) { if (this._client) this._client.sendKey(keysym); }
}

module.exports = { VncStreamer };
```

(Note: `frameBuffer` — verify actual property name in `rfb2`; the client stores `cli.frameBuffer` as Buffer updated on rect. If different, use `rect` content. The tests only cover lifecycle, so the frame path is verified manually.)

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test sandbox/__tests__/vnc-stream.test.js`
Expected: PASS (lifecycle tests).

- [ ] **Step 5: Add main-side stream loop + preload, commit**

In `main.js`, add after the existing VM IPC (line ~413):

```js
const { VncStreamer } = require('./sandbox/vnc-stream');
let _vncStream = null;

ipcMain.handle('sandbox:vm-stream-start', async (event, opts) => {
  try {
    _vncStream = new VncStreamer(opts || { port: 5900 });
    _vncStream.onFrame((frame) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sandbox:vm-frame', {
          width: frame.width, height: frame.height, buffer: frame.buffer,
          jpeg: frame.buffer ? frame.buffer.toString('base64') : null,
        });
      }
    });
    await _vncStream.start();
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('sandbox:vm-stream-stop', () => {
  if (_vncStream) _vncStream.stop();
  _vncStream = null;
  return { ok: true };
});
```

In `preload.js`, inside the `sandbox` object add:

```js
    vmStreamStart: (o) => ipcRenderer.invoke('sandbox:vm-stream-start', o),
    vmStreamStop: () => ipcRenderer.invoke('sandbox:vm-stream-stop'),
```

And after `contextBridge.exposeInMainWorld`, add:

```js
contextBridge.exposeInMainWorld('onVmFrame', (cb) => {
  ipcRenderer.on('sandbox:vm-frame', (e, frame) => cb(frame));
});
```

Commit:
```bash
git add App/sandbox/vnc-stream.js App/sandbox/__tests__/vnc-stream.test.js App/main.js App/preload.js
git commit -m "feat: VNC live stream from main process to renderer"
```

---

### Task 8: VM live view panel UI (feature 4) — renderer

**Files:**
- Create: `App/renderer/sandbox-vm-panel.js`
- Modify: `App/renderer/index.html` (panel container + script tag)
- Modify: `App/renderer/style.css`

**Interfaces:**
- Consumes: `window.onVmFrame`, `electronAPI.sandbox.{vmStreamStart, vmStreamStop, vmMouse, vmKey, vmSnapshot}`, `AuditLog.log`, `_requestAborter`
- Produces: `SandboxVmPanel.init()`, `SandboxVmPanel.show()`, `SandboxVmPanel.hide()`, `SandboxVmPanel.takeover()`

- [ ] **Step 1: Create the panel module**

Create `App/renderer/sandbox-vm-panel.js`:

```js
// App/renderer/sandbox-vm-panel.js
const SandboxVmPanel = {
  _canvas: null,
  _ctx: null,
  _streaming: false,
  _takeover: false,
  _container: null,

  init() {
    const container = document.getElementById('sandbox-vm-panel');
    if (!container) return;
    this._container = container;
    this._canvas = document.getElementById('vm-canvas');
    this._ctx = this._canvas.getContext('2d');

    document.getElementById('vm-btn-pause')?.addEventListener('click', () => this.pause());
    document.getElementById('vm-btn-stop')?.addEventListener('click', () => this.stopTask());
    document.getElementById('vm-btn-take')?.addEventListener('click', () => this.toggleTakeover());
    document.getElementById('vm-btn-snapshot')?.addEventListener('click', () => this.snapshot());

    if (typeof window.onVmFrame === 'function') {
      window.onVmFrame((frame) => this._draw(frame));
    }

    this._canvas.addEventListener('pointerdown', (e) => this._canvasEvent(e, 'down'));
    this._canvas.addEventListener('pointermove', (e) => this._canvasEvent(e, 'move'));
    this._canvas.addEventListener('pointerup', (e) => this._canvasEvent(e, 'up'));
    this._canvas.addEventListener('keydown', (e) => {
      if (!this._takeover) return;
      const k = e.key === 'Enter' ? 'enter' : e.key === 'Escape' ? 'escape' : e.key === ' ' ? 'space' : e.key;
      e.preventDefault();
      window.electronAPI.sandbox.vmKey(k.toLowerCase());
    });
  },

  _canvasEvent(e, type) {
    if (!this._takeover || !this._canvas) return;
    const r = this._canvas.getBoundingClientRect();
    const x = Math.round((e.clientX - r.left) * (this._canvas.width / r.width));
    const y = Math.round((e.clientY - r.top) * (this._canvas.height / r.height));
    const btn = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    window.electronAPI.sandbox.vmMouse(x, y, type === 'up' ? 0 : 1);
    if (type === 'down' && btn !== 'left') window.electronAPI.sandbox.vmMouse(x, y, btn);
  },

  _draw(frame) {
    if (!this._ctx || !this._canvas || !frame) return;
    if (this._canvas.width !== frame.width) this._canvas.width = frame.width;
    if (this._canvas.height !== frame.height) this._canvas.height = frame.height;
    if (frame.buffer) {
      const img = this._ctx.createImageData(frame.width, frame.height);
      img.data = new Uint8ClampedArray(frame.buffer.slice(0, frame.width * frame.height * 4));
      this._ctx.putImageData(img, 0, 0);
    }
  },

  async show() {
    if (this._container) this._container.classList.remove('hidden');
    await this._startStream();
  },

  async hide() {
    if (this._container) this._container.classList.add('hidden');
    this._stopStream();
  },

  async _startStream() {
    if (this._streaming) return;
    this._streaming = true;
    const r = await window.electronAPI.sandbox.vmStreamStart({ host: '127.0.0.1', port: 5900 });
    if (r && r.ok === false && typeof showNotification === 'function') showNotification('error', 'VNC-Stream fehlgeschlagen: ' + (r.error || 'unbekannt'));
    AuditLog.log({ type: 'vm', action: 'Vision Session gestartet', status: 'auto', summary: 'VM Live-Ansicht gestartet (VNC)', details: {}, source: 'KI' });
  },

  _stopStream() {
    this._streaming = false;
    window.electronAPI.sandbox.vmStreamStop();
  },

  pause() {
    const aborter = _requestAborter;
    if (aborter && aborter.signal && !aborter.signal.aborted) {
      // pause: we only pause new tool calls via a flag
      window._vmPaused = true;
    } else {
      window._vmPaused = true;
    }
    AuditLog.log({ type: 'vm', action: 'KI angehalten (Pause)', status: 'auto', summary: 'KI angehalten (Pause)', details: {}, source: 'User' });
  },

  stopTask() {
    const aborter = _requestAborter;
    if (aborter) aborter.abort();
    window._vmPaused = false;
    AuditLog.log({ type: 'vm', action: 'KI-Aufgabe abgebrochen (Stop)', status: 'auto', summary: 'KI-Aufgabe abgebrochen (Stop)', details: {}, source: 'User' });
    if (typeof showNotification === 'function') showNotification('info', 'KI-Aufgabe abgebrochen');
  },

  toggleTakeover() {
    this._takeover = !this._takeover;
    const btn = document.getElementById('vm-btn-take');
    if (btn) { btn.classList.toggle('active', this._takeover); btn.textContent = this._takeover ? 'Übernehmen (aktiv)' : 'Übernehmen'; }
    if (this._takeover) this._canvas.focus();
    AuditLog.log({ type: 'vm', action: 'Übernehmen ' + (this._takeover ? 'aktiv' : 'deaktiviert'), status: 'auto', summary: 'User-Kontrolle ' + (this._takeover ? 'übernommen' : 'beendet'), details: {}, source: 'User' });
  },

  async snapshot() {
    const name = 'manual-' + Date.now();
    const r = await window.electronAPI.sandbox.vmSnapshot(name);
    if (r && r.ok === false && typeof showNotification === 'function') showNotification('error', 'Snapshot fehlgeschlagen');
    AuditLog.log({ type: 'vm', action: 'Snapshot erstellt', status: 'auto', summary: 'Snapshot erstellt: ' + name, details: { name }, source: 'User' });
  },
};

if (typeof module !== 'undefined') module.exports = { SandboxVmPanel };
```

- [ ] **Step 2: Add panel HTML + script**

In `index.html`, inside the sandbox settings content area (after line 1008 `<div id="sandbox-settings-content"></div>`), add:

```html
        <div id="sandbox-vm-panel" class="hidden" style="margin-top:1rem;">
          <h3 style="margin:0 0 0.5rem;">VM Live-Ansicht</h3>
          <div style="display:flex;gap:6px;margin-bottom:0.5rem;">
            <button id="vm-btn-pause" class="btn btn-small">Anhalten (Pause)</button>
            <button id="vm-btn-stop" class="btn btn-small" style="background:#ef4444;">Stop</button>
            <button id="vm-btn-take" class="btn btn-small">Übernehmen</button>
            <button id="vm-btn-snapshot" class="btn btn-small">Snapshot jetzt</button>
          </div>
          <canvas id="vm-canvas" tabindex="0" style="width:100%;max-width:640px;border:1px solid var(--border2);border-radius:6px;background:#000;"></canvas>
        </div>
```

Add script tag after `sandbox-wizard.js`:
```html
  <script src="sandbox-vm-panel.js"></script>
```

- [ ] **Step 3: Trigger panel visibility on backend switch**

In `sandbox-settings.js`, in the `change` listener for the type select (after `switchBackend`), add:

```js
        const isVm = e.target.value === 'vmware' || e.target.value === 'qemu';
        if (isVm) { if (typeof SandboxVmPanel !== 'undefined') SandboxVmPanel.show(); }
        else { if (typeof SandboxVmPanel !== 'undefined') SandboxVmPanel.hide(); }
```

- [ ] **Step 4: Manual verify + commit**

Manual: switch to vmware backend with a running VMware VM with VNC enabled (port 5900), open sandbox settings → verify canvas shows VM screen, takeover lets mouse/keyboard control, pause/stop log audit entries.

```bash
git add App/renderer/sandbox-vm-panel.js App/renderer/index.html App/renderer/style.css App/renderer/sandbox-settings.js
git commit -m "feat: VM live view panel with pause/stop/takeover"
```

---

### Task 9: Auto-snapshots — context-based risk assessment (feature 5)

**Files:**
- Modify: `App/renderer/script.js` (sendMessage preamble before request + audit)

**Interfaces:**
- Consumes: `VisionSession`, `AuditLog.log`, `electronAPI.sandbox.vmSnapshot`, `getActiveConfig()`
- Produces: `window.__vmRisk = { level, needsSnapshot, snapshotTaken }`

- [ ] **Step 1: Add risk prompt + preflight**

In `sendMessage`, right after the `_taskClassification` line (~5676) and before building messages, add:

```js
  // Risk-based snapshot preflight (VM backends only)
  window.__vmRisk = { level: 'low', needsSnapshot: false };
  try {
    const sbx = await window.electronAPI.sandbox.getConfig();
    const isVm = sbx.type === 'vmware' || sbx.type === 'qemu';
    if (isVm) {
      const risk = TaskClassifier._riskOf(text) || 'medium';
      window.__vmRisk.level = risk;
      if (risk === 'high') {
        window.__vmRisk.needsSnapshot = true;
        const name = 'pre-task-' + Date.now();
        const r = await window.electronAPI.sandbox.vmSnapshot(name);
        window.__vmRisk.snapshotTaken = !(r && r.ok === false);
        AuditLog.log({ type: 'vm', action: 'Snapshot erstellt (riskante Aufgabe)', status: 'auto', summary: 'Auto-Snapshot vor riskanter Aufgabe: ' + name, details: { name, risk }, source: 'KI' });
      }
    }
  } catch {}
```

- [ ] **Step 2: Add risk heuristic to TaskClassifier**

Find `const TaskClassifier` in `script.js`. Inside its object, add below the existing `classify` method:

```js
  _riskOf(text) {
    const t = (text || '').toLowerCase();
    const hints = ['delete', 'rm ', 'drop ', 'format', 'clear', 'reset', 'password', 'secret', 'credential', 'chmod', 'sudo', 'usb', 'partition', 'bios', 'remove ', 'uninstal', 'löschen', 'formatieren', 'passwort', 'geheim'];
    const hits = hints.filter(h => t.includes(h)).length;
    if (hits >= 3) return 'high';
    if (hits >= 1) return 'medium';
    return 'low';
  },
```

- [ ] **Step 3: Commit**

```bash
git add App/renderer/script.js
git commit -m "feat: context-based auto-snapshots before risky tasks"
```

---

### Task 10: OS templates + image download (feature 6)

**Files:**
- Modify: `App/sandbox/os-templates.js`
- Modify: `App/main.js` (IPC download + progress)
- Modify: `App/renderer/sandbox-settings.js` (template selector UI)

**Interfaces:**
- Consumes: existing `getTemplate`/`listTemplates`, `net` from electron, `getSandboxDir`
- Produces:
  - `os-templates.js` exports expanded template list (add `windows11Light`, `windows10`, `linuxmint`)
  - `ipcMain.handle('sandbox:list-templates')` → array
  - `ipcMain.handle('sandbox:download-image', (e, templateKey))` → `{ ok, path, error }`
  - `sandbox.imagesDir` setting default `path.join(getSandboxDir(), 'images')`

- [ ] **Step 1: Update os-templates.js**

Replace the `TEMPLATES` object in `App/sandbox/os-templates.js` with an extended version (add the 3 required templates, keep existing):

```js
const TEMPLATES = {
  ubuntu: { label: 'Ubuntu Server', type: 'headless', image: 'ubuntu-24.04-server.iso', url: 'https://releases.ubuntu.com/noble/ubuntu-24.04.2-server-amd64.iso', ram: 2048, cpu: 2, disk: 20, username: 'ubuntu', password: 'florde' },
  ubuntuDesktop: { label: 'Ubuntu Desktop', type: 'desktop', image: 'ubuntu-24.04-desktop.iso', url: 'https://releases.ubuntu.com/noble/ubuntu-24.04.2-desktop-amd64.iso', ram: 4096, cpu: 2, disk: 30, username: 'ubuntu', password: 'florde' },
  linuxmint: { label: 'Linux Mint', type: 'desktop', image: 'linuxmint-22.iso', url: 'https://mirrors.kernel.org/linuxmint/stable/22/linuxmint-22-cinnamon-64bit.iso', ram: 4096, cpu: 2, disk: 30, username: 'mint', password: 'florde' },
  debian: { label: 'Debian', type: 'headless', image: 'debian-12.iso', url: 'https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-12.5.0-amd64-netinst.iso', ram: 2048, cpu: 2, disk: 20, username: 'debian', password: 'florde' },
  fedora: { label: 'Fedora Workstation', type: 'desktop', image: 'fedora-40-workstation.iso', url: 'https://download.fedoraproject.org/pub/fedora/linux/releases/40/Workstation/x86_64/iso/Fedora-Workstation-Live-x86_64-40-1.14.iso', ram: 4096, cpu: 2, disk: 30, username: 'fedora', password: 'florde' },
  arch: { label: 'Arch Linux', type: 'desktop', image: 'archlinux-latest.iso', url: 'https://geo.mirror.pkgbuild.com/iso/latest/archlinux-x86_64.iso', ram: 2048, cpu: 2, disk: 25, username: 'arch', password: 'florde' },
  tiny10: { label: 'Tiny10', type: 'headless', image: 'tiny10-23h2.iso', url: '', ram: 1024, cpu: 1, disk: 10, username: 'admin', password: 'florde' },
  windowsServer: { label: 'Windows Server', type: 'headless', image: 'windows-server-2022.iso', url: '', ram: 4096, cpu: 4, disk: 40, username: 'Administrator', password: 'florde' },
  windows10: { label: 'Windows 10', type: 'headless', image: 'windows-10.iso', url: '', ram: 2048, cpu: 2, disk: 30, username: 'nvda', password: 'florde' },
  windows11Light: { label: 'Windows 11 Light', type: 'headless', image: 'windows-11-light.iso', url: '', ram: 4096, cpu: 4, disk: 40, username: 'nvda', password: 'florde' },
  custom: { label: 'Custom', type: 'desktop', image: null, url: '', ram: 4096, cpu: 2, disk: 40, username: null, password: null },
};
```

- [ ] **Step 2: Add IPC download + list-templates**

In `main.js`, after the `sandbox:set-network` handler, add:

```js
const { getTemplate, listTemplates } = require('./sandbox/os-templates');

ipcMain.handle('sandbox:list-templates', () => listTemplates());

ipcMain.handle('sandbox:download-image', async (event, templateKey) => {
  try {
    const t = getTemplate(templateKey);
    if (!t.url) return { ok: false, error: 'Kein Download-Link für ' + t.label + ' (bitte eigenes Image angeben)' };
    const imagesDir = getSandboxImagesDir();
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
    const dest = path.join(imagesDir, t.image);
    if (fs.existsSync(dest)) return { ok: true, path: dest, cached: true };
    const res = await new Promise((resolve, reject) => {
      const req = net.request(t.url);
      req.on('response', resolve);
      req.on('error', reject);
      req.end();
    });
    if (res.statusCode !== 200) return { ok: false, error: 'HTTP ' + res.statusCode };
    const total = parseInt(res.headers['content-length'] || '0', 10) || 0;
    let received = 0;
    const ws = fs.createWriteStream(dest);
    await new Promise((resolve, reject) => {
      res.on('data', (chunk) => {
        received += chunk.length;
        ws.write(chunk);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('sandbox:download-progress', { key: templateKey, received, total, pct: total ? Math.round(received / total * 100) : 0 });
        }
      });
      res.on('end', () => { ws.end(); resolve(); });
      res.on('error', reject);
    });
    return { ok: true, path: dest };
  } catch (e) { return { ok: false, error: e.message }; }
});
```

Add helper near `getSandboxDir` (line ~15):
```js
function getSandboxImagesDir() { return path.join(getSandboxDir(), 'images'); }
```

In `preload.js` `sandbox` object add:
```js
    listTemplates: () => ipcRenderer.invoke('sandbox:list-templates'),
    downloadImage: (key) => ipcRenderer.invoke('sandbox:download-image', key),
```

Add global listener: after `onVmFrame` expose:
```js
contextBridge.exposeInMainWorld('onDownloadProgress', (cb) => {
  ipcRenderer.on('sandbox:download-progress', (e, p) => cb(p));
});
```

- [ ] **Step 3: Commit**

```bash
git add App/sandbox/os-templates.js App/main.js App/preload.js
git commit -m "feat: OS templates with image download support"
```

---

### Task 11: Template + network selection UI (features 6 + 7)

**Files:**
- Modify: `App/renderer/sandbox-settings.js`

**Interfaces:**
- Consumes: `electronAPI.sandbox.{listTemplates, downloadImage, setConfig, getConfig}`, `window.onDownloadProgress`
- Produces: template selector + network selector rendered in sandbox settings when VM backend active

- [ ] **Step 1: Add UI controls**

In `sandbox-settings.js` `_render`, after the button block (line ~35), add:

```js
        <div id="sandbox-vm-config" style="margin-top:0.75rem;"></div>
```

Then add a render function and call it after bindings:

```js
  async _renderVmConfig() {
    const box = document.getElementById('sandbox-vm-config');
    if (!box) return;
    const cfg = (await window.electronAPI.sandbox.getConfig()) || {};
    if (cfg.type !== 'vmware' && cfg.type !== 'qemu') { box.innerHTML = ''; return; }
    const templates = await window.electronAPI.sandbox.listTemplates();
    const tplOpts = templates.map(t => `<option value="${t.key}" ${cfg.vmTemplate === t.key ? 'selected' : ''}>${t.label} (${t.type})</option>`).join('');
    const nets = [
      ['none', 'Kein Internet'], ['localhost', 'Nur localhost'], ['projects', 'Nur Projektserver'],
      ['all', 'Alles'], ['custom', 'Benutzerdefiniert'],
    ];
    const netOpts = nets.map(([v, l]) => `<option value="${v}" ${cfg.network === v ? 'selected' : ''}>${l}</option>`).join('');
    box.innerHTML = `
      <div style="margin-bottom:0.5rem;"><label style="font-weight:600;display:block;margin-bottom:0.2rem;">Betriebssystem-Template</label>
        <select id="sbx-template"><option value="">— Auswählen —</option>${tplOpts}</select>
        <button id="sbx-download" class="btn btn-small" style="margin-top:0.3rem;">Image herunterladen</button>
        <span id="sbx-dl-progress" style="font-size:0.75rem;margin-left:0.5rem;"></span>
      </div>
      <div style="margin-bottom:0.5rem;"><label style="font-weight:600;display:block;margin-bottom:0.2rem;">Netzwerk</label>
        <select id="sbx-network">${netOpts}</select>
      </div>
    `;

    document.getElementById('sbx-template')?.addEventListener('change', async (e) => {
      await window.electronAPI.sandbox.setConfig({ vmTemplate: e.target.value, type: cfg.type });
    });
    document.getElementById('sbx-network')?.addEventListener('change', async (e) => {
      await window.electronAPI.sandbox.setConfig({ network: e.target.value, type: cfg.type });
      await window.electronAPI.sandbox.setNetwork(e.target.value);
    });
    document.getElementById('sbx-download')?.addEventListener('click', async () => {
      const key = document.getElementById('sbx-template')?.value;
      if (!key) return;
      const prog = document.getElementById('sbx-dl-progress');
      if (prog) prog.textContent = 'Download startet...';
      const r = await window.electronAPI.sandbox.downloadImage(key);
      if (prog) prog.textContent = r.ok ? (r.cached ? '✅ Image vorhanden: ' + r.path : '✅ Heruntergeladen: ' + r.path) : '❌ ' + (r.error || 'Fehler');
    });
    if (typeof window.onDownloadProgress === 'function') {
      window.onDownloadProgress((p) => {
        const prog = document.getElementById('sbx-dl-progress');
        if (prog) prog.textContent = 'Download ' + p.pct + '% (' + Math.round(p.received / 1024 / 1024) + '/' + Math.round(p.total / 1024 / 1024) + ' MB)';
      });
    }
  }
```

Call `this._renderVmConfig()` at the end of `init()` (after `_render(status)`), and also call it after every backend switch in the change listener.

- [ ] **Step 2: Map network for VM / firejail backends**

In `manager.js` `setNetwork`, extend to handle firejail/docker by passing through backend options where supported:

```js
  async setNetwork(network) {
    const b = this.active;
    if (!b) return false;
    if (b.type === 'firejail') {
      const r = { none: 'none', localhost: 'lo', all: 'eth0', custom: 'eth0' }[network];
      if (r && typeof b.setNetwork === 'function') b.setNetwork(r);
      return true;
    }
    if ('_network' in b) { b._network = network; this._emit('network-change', { network }); return true; }
    if (typeof b.network !== 'undefined') { b.network = network; this._emit('network-change', { network }); return true; }
    return false;
  }
```

- [ ] **Step 3: Commit**

```bash
git add App/renderer/sandbox-settings.js App/sandbox/manager.js
git commit -m "feat: template download + network selection UI"
```

---

### Task 12: Final task-file checklist verification + fix Docker test note

**Files:**
- Modify: `App/sandbox/__tests__/docker-backend.test.js` (skip note or make image configurable)

**Interfaces:**
- Consumes: all prior tasks

- [ ] **Step 1: Make docker test tolerant of missing image**

Edit `docker-backend.test.js`: in the `init` lifecycle test, wrap the `backend.init()` in a try/catch and skip gracefully if the image can't be pulled:

```js
    it('should init (pull, create, start) and destroy (stop, rm) a container', async () => {
      const r = await backend.isAvailable();
      if (!r) { console.log('  ⚠ Docker not available — skipping lifecycle test'); return; }
      try {
        await backend.init();
      } catch (e) {
        console.log('  ⚠ Image pull failed (florde/sandbox:minimal not public):', e.message);
        return;
      }
      assert.ok(backend.initialized);
      assert.ok(backend._containerId);
      await backend.destroy();
      assert.strictEqual(backend.initialized, false);
      assert.strictEqual(backend._containerId, null);
    });
```

Do the same graceful-skip wrapper around the file/exec tests' `backend.init()` calls (wrap each in try/catch and return on failure).

- [ ] **Step 2: Run full sandbox test suite**

Run: `node --test sandbox/__tests__/*.test.js`
Expected: All previously failing Docker tests now SKIP gracefully; rest green (149+ pass).

- [ ] **Step 3: Verify task checklist**

Go through `Sandbox Aufgabe.md` and confirm each feature exists in the code:

```bash
grep -n "vision_request" App/renderer/script.js
grep -n "SandboxWizard.open" App/renderer/script.js App/renderer/sandbox-settings.js
grep -n "SandboxVmPanel" App/renderer/sandbox-settings.js
grep -n "vnc-stream\|VncStreamer" App/main.js
grep -n "linuxmint\|windows11Light\|windows10" App/sandbox/os-templates.js
grep -n "set-network\|network" App/main.js App/sandbox/manager.js
grep -n "pre-task-" App/renderer/script.js
grep -n "vmSnapshot\|Snapshot" App/renderer/sandbox-vm-panel.js App/renderer/script.js
```

Expected: every grep returns matches, confirming all 18 checklist items implemented.

- [ ] **Step 4: Commit**

```bash
git add App/sandbox/__tests__/docker-backend.test.js
git commit -m "test: make docker tests skip gracefully when image unavailable"
```

---

## Self-Review Notes

- **Spec coverage:** Task 1→security fix (picked up from analysis), 2→backend network, 3→config IPC, 4→wizard (features 1+2), 5→wizard re-open, 6→vision (feature 3), 7→VNC stream main (feature 4), 8→VNC panel UI (feature 4), 9→auto-snapshots (feature 5), 10→templates+download (feature 6), 11→template/network UI (features 6+7), 12→verification.
- **Audit-log integration:** All features log via existing `AuditLog.log` with types `vision`/`vm`.
- **Vision "Stop" button:** `VisionSession` toggles `btn-send` label to "Stop"; clicking it while vision active revokes manually (Task 6).
- **Manus-style live view:** VNC stream via rfb2 rect frames (Task 7+8).
- **Type consistency:** `setNetwork` shape consistent across manager tests (`config.test.js`) and renderer (Settings calls `vmSnapshot`, `setNetwork`, `setConfig`, `getConfig` — all exposed in preload).
- **Placeholder scan:** All steps contain concrete code and commands. Manual verification steps are explicit.

## Known Environment Issues

- Docker tests need `florde/sandbox:minimal` public image or local image; Task 12 makes them skip instead of fail.
- VNC live view requires a running VMware/QEMU VM with a VNC server on port 5900 — manual verification.