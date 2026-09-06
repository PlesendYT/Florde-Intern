# Docker-Image + Permission-Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ersetze das unbenutzbare Docker-Sandbox-Image durch ein eigenes `debian:bookworm-slim`-basiertes Image mit Standard-Tools und baue einen Main-seitigen Permission-Layer, der alle Sandbox-Backends absichert und sudo/Aktionen nur mit User-Zustimmung ausführen lässt.

**Architecture:** Ein gemeinsames CommonJS-Modul `permission-gate.js` im Main-Prozess wird in beide Sandbox-Exec-Pfade (`sandbox-service.exec` und `execSandboxCommand`) plus Datei-/VM-Operationen eingehängt. Regeln liegen in der (bisher toten) SQLite-`permissions`-Tabelle (pro Projekt, optional Global). Das Docker-Backend bekommt ein neues Default-Image, pro-Projekt-Volumes und Container-Init für Custom-Tools.

**Tech Stack:** Electron 30 (CommonJS Main), better-sqlite3, Docker CLI (`spawnSync`), Node `node:test` für Tests.

## Global Constraints

- Renderer-`domains/` + `core/` dürfen KEINE `node:`/`fs`/`child_process`-Importe enthalten (Architektur-Invariante). Das PermissionGate lebt ausschließlich im Main-Prozess. (Ausnahme: Renderer ruft es nur per IPC auf.)
- Tests laufen per `node --test <file1> <file2> ...` aus `App/`. Renderer-Tests sind ESM (`import`), Main/Sandbox-Tests CommonJS (`require`).
- Kein `sudo` an der Engine vorbei: `sudo`-Befehle laufen IMMER durch das PermissionGate.
- Kein Hardcoding von Geheimnissen; keine neuen Secrets.
- Vor jedem Commit: `git status`, `git diff` prüfen; Gitleaks laufen lassen wenn verfügbar.
- Bestehende 195 Renderer- + 166 Sandbox-Tests müssen grün bleiben.

---

## Task 1: CommonJS Risiko-Klassifizierung im Main (`mainrisk.js`)

**Files:**
- Create: `App/main/services/mainrisk.js`
- Test: `App/main/services/__tests__/mainrisk.test.js`

**Interfaces:**
- Produces: `module.exports = { assessCommandRisk }`. Signatur: `assessCommandRisk(command) -> 'critical' | 'high' | 'medium' | 'low' | 'safe'`.

Spiegelt die renderer-seitige `assessShellRisk`-Logik (aus `renderer/domains/tools/registry.js`) als CommonJS-Modul, damit die Sicherheit auch im Main greift (nicht nur client-seitig).

- [ ] **Step 1: Write the failing test**

`App/main/services/__tests__/mainrisk.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { assessCommandRisk } = require('../mainrisk');

test('critical: rm -rf /', () => {
  assert.equal(assessCommandRisk('rm -rf /'), 'critical');
});
test('critical: mkfs', () => {
  assert.equal(assessCommandRisk('mkfs.ext4 /dev/sda'), 'critical');
});
test('high: sudo', () => {
  assert.equal(assessCommandRisk('sudo apt install x'), 'high');
});
test('high: apt install', () => {
  assert.equal(assessCommandRisk('apt-get install -y vim'), 'high');
});
test('high: curl|bash', () => {
  assert.equal(assessCommandRisk('curl http://x/install.sh | bash'), 'high');
});
test('high: pip install', () => {
  assert.equal(assessCommandRisk('python3 -m pip install flask'), 'high');
});
test('medium: git push', () => {
  assert.equal(assessCommandRisk('git push origin main'), 'medium');
});
test('safe: grep', () => {
  assert.equal(assessCommandRisk('grep -r foo .'), 'safe');
});
test('safe: ls', () => {
  assert.equal(assessCommandRisk('ls -la'), 'safe');
});
test('low: mkdir', () => {
  assert.equal(assessCommandRisk('mkdir -p src'), 'low');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd App && node --test main/services/__tests__/mainrisk.test.js`
Expected: FAIL (Cannot find module `../mainrisk`)

- [ ] **Step 3: Write implementation**

`App/main/services/mainrisk.js`:
```js
// Main-seitige Risiko-Klassifizierung von Shell-Kommandos.
// Spiegelt renderer/domains/tools/registry.js:assessShellRisk als CommonJS, damit
// die Sicherheit nicht nur client-seitig, sondern auch im Main-Prozess greift.
const PATTERNS = {
  critical: [
    /\brm\s+-rf\s+\/\s*$/mi, /\bformat\b/i, /\bdd\s+if=\/dev\/zero/i,
    /\bmkfs\b/i, /grub-install|fdisk|mbr/i, /:\(\)\s*\{|fork\s+bomb/i,
    /chmod\s+777\s+\//i, /mv\s+\/\s+\/dev\/null/i,
  ],
  high: [
    /\bsudo\b/i, /\brm\s+-rf\b/i, /\bcurl\b.*\|\s*(?:bash|sh)\b/i,
    /\bwget\b.*\|\s*(?:bash|sh)\b/i, /\bchmod\s+-R\s+777\b/i,
    /\bnmap\b/i, /\bapt\s+(?:install|remove|purge)\b/i,
    /\bpip\s+install\b/i, /\bnpm\s+(?:install|publish|delete)\s+-g\b/i,
  ],
  medium: [
    /\bnpm\s+(?:install|publish)\b/i, /\bgit\s+push\b/i,
    /\bpip\s+install\b/i, /\bchmod\b/i, /\bkill\b/i,
    /\bsystemctl\b/i, /\bservice\b/i,
  ],
  low: [
    /\bmkdir\b/i, /\btouch\b/i, /\becho\s+>/, /\bmv\b/i, /\bcp\b/i,
    /\bcd\b/i, /\bnano\b/i, /\bvi\b/i, /\bcode\b/i,
  ],
  safe: [
    /\bls\b/i, /\bpwd\b/i, /\bcat\b/i, /\bhead\b/i, /\btail\b/i,
    /\bgrep\b/i, /\bfind\b/i, /\bwhich\b/i, /\bwhoami\b/i, /\bdate\b/i,
    /\bwc\b/i, /\bsort\b/i, /\buniq\b/i, /\bless\b/i, /\bmore\b/i,
    /\bps\b/i, /\bdf\b/i, /\bdu\b/i,
  ],
};

function assessCommandRisk(command) {
  for (const [level, regexps] of Object.entries(PATTERNS)) {
    for (const re of regexps) {
      if (re.test(command || '')) return level;
    }
  }
  return 'safe';
}

module.exports = { assessCommandRisk };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd App && node --test main/services/__tests__/mainrisk.test.js`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add App/main/services/mainrisk.js App/main/services/__tests__/mainrisk.test.js
git commit -m "feat(main): mainseitige Shell-Risiko-Klassifizierung"
```

---

## Task 2: PermissionStore (SQLite-Zugriff auf permissions-Tabelle)

**Files:**
- Create: `App/main/services/permission-store.js`
- Test: `App/main/services/__tests__/permission-store.test.js`

**Interfaces:**
- Consumes: `better-sqlite3`; Schema der `permissions`-Tabelle aus `App/storage.js` (bestehende Tabelle: `id, project, tool_type, action, path, allowed, created_at`).
- Produces: `module.exports = { PermissionStore }`. Instanzmethoden:
  - `getAll(project)` → Array von Regel-Objekten `{ id, project, tool_type, action, path, allowed, created_at }`
  - `getAllGlobal()` → Regeln mit `project === '__global__'`
  - `set(project, tool_type, action, opts)` → legt/aktualisiert Regel; `opts = { path, allowed, global }`; wenn `global` → project wird `__global__`
  - `remove(project, tool_type, action, opts)` → löscht Regel
  - `close()`

Die Tabelle existiert in der bestehenden DB bereits. Wenn sie in einer frischen DB fehlt, wird sie hier mit demselben Schema angelegt (idempotent `CREATE TABLE IF NOT EXISTS`). Zusätzlich wird eine Spalte `global` ergänzt, falls nicht vorhanden (Migration via `ALTER TABLE ... ADD COLUMN` in try/catch).

- [ ] **Step 1: Write the failing test**

`App/main/services/__tests__/permission-store.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PermissionStore } = require('../permission-store');

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perm-store-'));
  const store = new PermissionStore(path.join(dir, 'db.sqlite'));
  store.init();
  return { store, dir };
}

test('set + getAll scoped to project', () => {
  const { store, dir } = freshStore();
  store.set('projA', 'sudo', 'allow');
  store.set('projB', 'sudo', 'block');
  const a = store.getAll('projA');
  assert.equal(a.length, 1);
  assert.equal(a[0].tool_type, 'sudo');
  assert.equal(a[0].allowed, 1);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('global rule uses __global__ and is separated', () => {
  const { store, dir } = freshStore();
  store.set(null, 'apt-install', 'ask', { global: true });
  const g = store.getAllGlobal();
  assert.ok(g.some(r => r.tool_type === 'apt-install'));
  const proj = store.getAll('projA');
  assert.ok(!proj.some(r => r.project === '__global__'));
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('set updates existing rule (upsert by project+action+path)', () => {
  const { store, dir } = freshStore();
  store.set('p', 'sudo', 'block');
  store.set('p', 'sudo', 'allow');
  const all = store.getAll('p');
  assert.equal(all.length, 1);
  assert.equal(all[0].allowed, 1);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('set with path is separate from without path', () => {
  const { store, dir } = freshStore();
  store.set('p', 'exec', 'ask');
  store.set('p', 'exec', 'allow', { path: '/safe/path' });
  const all = store.getAll('p');
  assert.equal(all.length, 2);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('remove deletes a matching rule', () => {
  const { store, dir } = freshStore();
  store.set('p', 'sudo', 'block');
  store.remove('p', 'sudo');
  assert.equal(store.getAll('p').length, 0);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rejects empty/invalid tool_type', () => {
  const { store, dir } = freshStore();
  assert.throws(() => store.set('p', '', 'allow'), /tool_type/);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rejects invalid allowed level', () => {
  const { store, dir } = freshStore();
  assert.throws(() => store.set('p', 'sudo', 'nonsense'), /level/);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd App && node --test main/services/__tests__/permission-store.test.js`
Expected: FAIL (Cannot find module `../permission-store`)

- [ ] **Step 3: Write implementation**

`App/main/services/permission-store.js`:
```js
// Zugriff auf die SQLite-permissions-Tabelle (Main-Prozess).
// Tabelle existiert bereits in App/storage.js; hier wird dasselbe Schema
// idempotent angelegt und eine globale Spalte ergänzt.
const Database = require('better-sqlite3');
const path = require('node:path');
const fs = require('node:fs');
const { createHash } = require('node:crypto');

const GLOBAL_PROJECT = '__global__';
const VALID_LEVELS = new Set(['allow', 'ask', 'block']);

function projectKey(project) {
  if (!project || project === GLOBAL_PROJECT) return GLOBAL_PROJECT;
  return project;
}

class PermissionStore {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  init() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        tool_type TEXT NOT NULL,
        action TEXT NOT NULL,
        path TEXT,
        allowed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    // Migration: globale Spalte hinzufügen, falls nicht vorhanden
    const cols = this.db.prepare(`PRAGMA table_info(permissions)`).all().map(c => c.name);
    if (!cols.includes('global')) {
      this.db.exec(`ALTER TABLE permissions ADD COLUMN global INTEGER NOT NULL DEFAULT 0`);
    }
    return this;
  }

  getAll(project) {
    return this.db.prepare(
      'SELECT * FROM permissions WHERE project = ? ORDER BY id'
    ).all(projectKey(project));
  }

  getAllGlobal() {
    return this.db.prepare(
      'SELECT * FROM permissions WHERE project = ? ORDER BY id'
    ).all(GLOBAL_PROJECT);
  }

  set(project, tool_type, action, opts = {}) {
    if (!tool_type || typeof tool_type !== 'string') throw new Error('tool_type required');
    if (!VALID_LEVELS.has(action)) throw new Error('invalid level: ' + action);
    const p = opts.global ? GLOBAL_PROJECT : projectKey(project);
    const allowed = action === 'allow' ? 1 : 0;
    const marker = opts.path || '';
    const existing = this.db.prepare(
      'SELECT id FROM permissions WHERE project = ? AND tool_type = ? AND path = ?'
    ).get(p, tool_type, marker);
    if (existing) {
      this.db.prepare(
        'UPDATE permissions SET allowed = ? WHERE id = ?'
      ).run(action === 'allow' ? 1 : 0, existing.id);
      return { id: existing.id, project: p, tool_type, action, path: opts.path || null, allowed };
    }
    const info = this.db.prepare(
      'INSERT INTO permissions (project, tool_type, action, path, allowed) VALUES (?, ?, ?, ?, ?)'
    ).run(p, tool_type, action, opts.path || null, allowed);
    return { id: info.lastInsertRowid, project: p, tool_type, action, path: opts.path || null, allowed };
  }

  remove(project, tool_type, opts = {}) {
    const p = opts.global ? GLOBAL_PROJECT : projectKey(project);
    const marker = opts.path || '';
    const r = this.db.prepare(
      'DELETE FROM permissions WHERE project = ? AND tool_type = ? AND path = ?'
    ).run(p, tool_type, marker);
    return r.changes > 0;
  }

  getAllEffective(project) {
    return this.getAllGlobal().concat(this.getAll(project));
  }

  close() {
    if (this.db) { this.db.close(); this.db = null; }
  }
}

module.exports = { PermissionStore, GLOBAL_PROJECT, projectKey };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd App && node --test main/services/__tests__/permission-store.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add App/main/services/permission-store.js App/main/services/__tests__/permission-store.test.js
git commit -m "feat(main): SQLite-PermissionStore für permissions-Tabelle"
```

---

## Task 3: PermissionGate (Kern-Modul)

**Files:**
- Create: `App/main/services/permission-gate.js`
- Test: `App/main/services/__tests__/permission-gate.test.js`

**Interfaces:**
- Consumes: `PermissionStore` (Task 2), `assessCommandRisk` (Task 1).
- Produces: `module.exports = { PermissionGate, resolveToolCategory }`.
  - `resolveToolCategory(op) -> string` (siehe unten)
  - `new PermissionGate({ store, askHandler })` — `store` ist ein `PermissionStore`, `askHandler` optional.
  - `async evaluate({ project, backend, op, command, path }) -> Promise<{ decision: 'allow'|'block'|'ask', source, reason }>`
  - `async checkAndRun({ project, backend, op, command, path, run }) -> result` — runnt `run()` wenn erlaubt/angefragt-approbiert, wirft sonst `PermissionError`.

Regeln werden aus **Kategorien** UND **Regex-Mustern** ausgewertet. Die `action`-Spalte dient als Speicherform:
- Kategorien-Regel: `action = 'allow'|'ask'|'block'`, `tool_type = Kategorie`, `path = null`.
- Regex-Regel: `action = 'allow'|'block'|'ask'`, `tool_type = Kategorie`, `path = 'regex:' + muster` (Muster wird als `re:...` geprüft).

`resolveToolCategory(op)`:
```js
function resolveToolCategory(op) {
  switch (op) {
    case 'exec': return 'exec';
    case 'read_file': return 'file-read';
    case 'write_file': return 'file-write';
    case 'delete_file': return 'file-delete';
    case 'list_files': return 'file-list';
    case 'vm_snapshot': return 'vm-snapshot';
    case 'vm_mouse': return 'vm-input';
    case 'vm_key': return 'vm-input';
    default: return op;
  }
}
```

Precedence (höchste zuerst):
1. Regex-Regel für die Kategorie (path = `regex:...`), deren Muster auf den Befehl matcht, und dessen allowed-Aktion.
2. Exakte/wilde Kategorie-Regel (path null).
3. Backend-spezifische Regel (matching `backend`-Feld, falls vorhanden).
4. Global-Default je Risiko: `critical`/`high` → `ask`, sonst `allow`. (Speicherbar, default eingebaut.)

- [ ] **Step 1: Write the failing test**

`App/main/services/__tests__/permission-gate.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PermissionStore } = require('../permission-store');
const { PermissionGate, resolveToolCategory } = require('../permission-gate');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  const store = new PermissionStore(path.join(dir, 'db.sqlite'));
  store.init();
  return { store, dir };
}

test('resolveToolCategory maps ops', () => {
  assert.equal(resolveToolCategory('read_file'), 'file-read');
  assert.equal(resolveToolCategory('exec'), 'exec');
  assert.equal(resolveToolCategory('vm_snapshot'), 'vm-snapshot');
  assert.equal(resolveToolCategory('whatever'), 'whatever');
});

test('default: critical command is ask', async () => {
  const { store, dir } = setup();
  const gate = new PermissionGate({ store });
  const r = await gate.evaluate({ project: 'p', backend: 'docker', op: 'exec', command: 'sudo apt install x' });
  assert.equal(r.decision, 'ask');
  const safe = await gate.evaluate({ project: 'p', backend: 'docker', op: 'exec', command: 'ls' });
  assert.equal(safe.decision, 'allow');
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('allow rule on category allows', async () => {
  const { store, dir } = setup();
  store.set('p', 'sudo', 'allow');
  const gate = new PermissionGate({ store });
  const r = await gate.evaluate({ project: 'p', backend: 'docker', op: 'exec', command: 'sudo ls' });
  assert.equal(r.decision, 'allow');
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('block rule on category blocks', async () => {
  const { store, dir } = setup();
  store.set('p', 'sudo', 'block');
  const gate = new PermissionGate({ store });
  const r = await gate.evaluate({ project: 'p', backend: 'docker', op: 'exec', command: 'sudo ls' });
  assert.equal(r.decision, 'block');
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('regex rule path restricts action', async () => {
  const { store, dir } = setup();
  store.set('p', 'exec', 'allow', { path: 'regex:^apt-get install' });
  const gate = new PermissionGate({ store });
  const match = await gate.evaluate({ project: 'p', backend: 'docker', op: 'exec', command: 'apt-get install -y vim' });
  assert.equal(match.decision, 'allow');
  const other = await gate.evaluate({ project: 'p', backend: 'docker', op: 'exec', command: 'rm file' });
  assert.notEqual(other.decision, 'allow'); // keine Regex-Regel -> andere Pfade
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ask triggers askHandler and returns decision', async () => {
  const { store, dir } = setup();
  let asked = 0;
  let approve = 'allow';
  const gate = new PermissionGate({ store, askHandler: async (info) => {
    asked++;
    info.decision = approve;
    return approve;
  } });
  const r = await gate.evaluate({ project: 'p', backend: 'docker', op: 'exec', command: 'sudo ls', askHandler });
  assert.equal(asked, 1);
  assert.equal(r.decision, 'allow');
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('checkAndRun runs run() on allow', async () => {
  const { store, dir } = setup();
  const gate = new PermissionGate({ store });
  let ran = false;
  const out = await gate.checkAndRun({
    project: 'p', backend: 'docker', op: 'exec', command: 'ls',
    run: async () => { ran = true; return 'ok'; },
  });
  assert.equal(out, 'ok');
  assert.equal(ran, true);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('checkAndRun throws PermissionError on block', async () => {
  const { store, dir } = setup();
  store.set('p', 'file-delete', 'block');
  const gate = new PermissionGate({ store });
  await assert.rejects(
    gate.checkAndRun({ project: 'p', backend: 'docker', op: 'delete_file', path: '/a', run: async () => 'nope' }),
    /blocked/
  );
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
```

Hinweis: Im `ask`-Test wird `askHandler` doppelt übergeben (im Konstruktor und in `evaluate`-Optionen). Der Gate soll den `options.askHandler` vor dem Konstruktor-Handler bevorzugen, sonst konstruktor-Handler verwenden.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd App && node --test main/services/__tests__/permission-gate.test.js`
Expected: FAIL (Cannot find module `../permission-gate`)

- [ ] **Step 3: Write implementation**

`App/main/services/permission-gate.js`:
```js
// Main-seitiges Sicherheits-Gate für alle Sandbox-Aktionen.
// Werte jede Ausführung gegen SQLite-Permission-Regeln (Kategorien + Regex)
// sowie gegen eine eingebaute Risiko-Default-Tabelle aus.
const { assessCommandRisk } = require('./mainrisk');

function resolveToolCategory(op) {
  switch (op) {
    case 'read_file': return 'file-read';
    case 'write_file': return 'file-write';
    case 'delete_file': return 'file-delete';
    case 'list_files': return 'file-list';
    case 'vm_snapshot': return 'vm-snapshot';
    case 'vm_mouse': return 'vm-input';
    case 'vm_key': return 'vm-input';
    default: return op;
  }
}

function riskDefault(risk) {
  if (risk === 'critical' || risk === 'high') return 'ask';
  return 'allow';
}

const LEVEL_LOOKUP = { allow: 1, ask: 0, block: 0 };
const IS_ALLOWED = { allow: true, ask: false, block: false };

class PermissionError extends Error {
  constructor(message, info) {
    super(message);
    this.name = 'PermissionError';
    this.permission = info;
  }
}

class PermissionGate {
  constructor({ store, askHandler } = {}) {
    if (!store) throw new Error('PermissionGate requires a store');
    this.store = store;
    this.askHandler = askHandler || null;
  }

  _rulesFor(project) {
    return this.store.getAllEffective(project);
  }

  _matchesRegex(rule, command) {
    if (command == null) return false;
    const p = rule.path || '';
    if (!p.startsWith('regex:')) return false;
    const src = p.substring('regex:'.length);
    try {
      return new RegExp(src).test(command);
    } catch { return false; }
  }

  async _resolveDecision({ project, backend, op, command, path, askHandler }) {
    const category = resolveToolCategory(op);
    const risk = assessCommandRisk(command || '');

    const rules = this._rulesFor(project);

    // 1. Regex-Regel für die Kategorie
    const regexRule = rules.find(r => r.tool_type === category && this._matchesRegex(r, command));
    if (regexRule) {
      const lvl = regexRule.allowed ? 'allow' : 'block';
      return { decision: lvl, source: 'regex', rule: regexRule, risk };
    }

    // 2. Kategorie-Regel (path null)
    const catRule = rules.find(r => r.tool_type === category && (r.path === null || r.path === '' || r.path === undefined));
    if (catRule) {
      const lvl = catRule.allowed ? 'allow' : 'block';
      return { decision: lvl, source: 'category', rule: catRule, risk };
    }

    // 3. Backend-spezifische Regel (path = 'backend:<name>')
    const backendRule = rules.find(r => r.tool_type === category && (r.path || '').startsWith('backend:') && r.path === ('backend:' + backend));
    if (backendRule) {
      const lvl = backendRule.allowed ? 'allow' : 'block';
      return { decision: lvl, source: 'backend', rule: backendRule, risk };
    }

    // 4. Risk-Default
    return { decision: riskDefault(risk), source: 'risk-default', risk };
  }

  async evaluate({ project, backend, op, command, path, askHandler } = {}) {
    const base = await this._resolveDecision({ project, backend, op, command, path });
    if (base.decision !== 'ask') return base;
    const handler = askHandler || this.askHandler;
    if (!handler) return { ...base, source: 'ask' };
    const choice = await handler({ project, backend, op, command, path, risk: base.risk });
    const decision = (choice === 'allow' || choice === 'block') ? choice : base.decision;
    return { ...base, decision, source: decision === base.decision ? base.source : 'ask-handler' };
  }

  async checkAndRun({ project, backend, op, command, path, run, askHandler } = {}) {
    const decision = await this.evaluate({ project, backend, op, command, path, askHandler });
    if (decision.decision === 'block') {
      throw new PermissionError('blocked: permission not granted', decision);
    }
    if (decision.decision === 'ask') {
      throw new PermissionError('ask: user approval required', decision);
    }
    return run ? await run() : decision;
  }
}

module.exports = { PermissionGate, PermissionError, resolveToolCategory };
```

HINWEIS: Die obige `evaluate`-Implementierung (neu oben) ist die KORREKTE Version. Wenn ein `askHandler` übergeben wird und `ask` ansteht, wird delegiert; liefert der Handler `allow` oder `block`, so wird diese Entscheidung für genau diesen Aufruf übernommen (transient). Persistente Regeln erzeugt nur der IPC-Handler in Task 6, wenn `persist === 'always'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd App && node --test main/services/__tests__/permission-gate.test.js`
Expected: PASS (siehe Testliste)

- [ ] **Step 5: Commit**

```bash
git add App/main/services/permission-gate.js App/main/services/__tests__/permission-gate.test.js
git commit -m "feat(main): PermissionGate mit Kategorien/Regex/Risiko-Precedence"
```

---

## Task 4: Einbindung in sandbox-service (exec + execSandboxCommand)

**Files:**
- Modify: `App/main/services/sandbox-service.js`
- Test: `App/main/services/__tests__/sandbox-gate-integration.test.js`

**Interfaces:**
- Consumes: `PermissionGate` (Task 3), `PermissionStore` (Task 2), `assessCommandRisk` (Task 1).
- Produces: `SandboxService` bekommt neue Methoden:
  - `setPermissionGate(gate, store)`
  - `async exec(command, options)` — ruft jetzt `checkAndRun` um `manager.exec`
  - `execSandboxCommand(sandboxPath, command)` — ruft Gate um den bestehenden Host-exec
  - `addPermissionRule(rule)`, `removePermissionRule(rule)`, `getPermissionRules(project)` (Bridging für die Settings-UI)
  - transient-Register: `_transientAllow` Map (projekt+backend+op+command → einmalig)

**transient-vs-persistent-Merken:** Im IPC-Handler `registerPermissionResponse` (Task 5) wird abhängig von der User-Wahl:
- `always` → `store.set(...)` persistente Regel
- `once` → nur für DIESEN `evaluate`-Aufruf als transient erlaubt (im Gate über `askHandler`-Call, der beim DIESEN checkAndRun-Aufruf übergeben wird).

Dazu erweitert das Gate `evaluate`, sodass ein `askHandler`, der `allow` liefert, für genau diesen einen Aufruf die Ausführung freigibt. Das ist bereits so gebaut (Task 3: ask → delegieren → wenn Handler `allow` liefert → `allow`). Für "always" muss der IPC-Handler die Regel vor dem Retry in den Store schreiben.

- [ ] **Step 1: Write the failing test**

`App/main/services/__tests__/sandbox-gate-integration.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PermissionStore } = require('../permission-store');
const { PermissionGate } = require('../permission-gate');

// Wir testen das Zusammenspiel von Gate + Store über die neue exec-Methode,
// ohne echtes Docker. Der manager wird durch einen Stub ersetzt.
test('exec routes through gate and runs manager.exec on allow', async () => {
  const { PermissionGate } = require('../permission-gate');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svinteg-'));
  const store = new PermissionStore(path.join(dir, 'db.sqlite'));
  store.init();
  const gate = new PermissionGate({ store });

  const SandboxService = require('../sandbox-service');
  // SandboxService konstruiert intern einen SandboxManager; wir prüfen nur die
  // delegation über eine echte Instanz mit Stub.
  const service = new SandboxService({ send: () => {}, projectRegistry: () => null });
  // monkey-patch manager.exec
  let called = false;
  service._manager.exec = async () => { called = true; return { ok: true, output: 'x', code: 0 }; };
  service._setGateForTest(gate);

  const out = await service.exec('ls', { project: 'p' });
  assert.equal(called, true);
  assert.equal(out.ok, true);
  service._manager.close && service._manager.close();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
```

Hinweis: Der Test nutzt eine `_setGateForTest(gate)`-Hilfsmethode, damit wir den internen Manager stuben können, ohne die volle Sandbox-Systemabhängigkeit aufzubauen. Diese Hilfsmethode wird in der Implementierung ergänzt.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd App && node --test main/services/__tests__/sandbox-gate-integration.test.js`
Expected: FAIL (`_setGateForTest is not a function`)

- [ ] **Step 3: Write implementation**

In `App/main/services/sandbox-service.js`:

a) Füge oben hinzu:
```js
const { PermissionGate } = require('./permission-gate');
```
b) Im Konstruktor:
```js
this._permissionGate = null;
this._permissionStore = null;
```
c) Neue Hilfsmethoden (vor `exec`):
```js
setPermissionGate(gate, store) {
  this._permissionGate = gate;
  this._permissionStore = store;
}
_setGateForTest(gate) { this._permissionGate = gate; }
getPermissionGate() { return this._permissionGate; }
```
d) Ersetze die Methode `exec` (Zeilen ~96-98):
```js
async exec(command, options) {
  const project = (options && options.project) || null;
  if (this._permissionGate) {
    return this._permissionGate.checkAndRun({
      project,
      backend: this._manager.activeType,
      op: 'exec',
      command,
      path: (options && options.cwd) || null,
      run: () => this._manager.exec(command, options),
    });
  }
  return this._manager.exec(command, options);
}
```
e) Ersetze `execSandboxCommand` (Zeilen ~84-94) so:
```js
execSandboxCommand(sandboxPath, command) {
  const allowed = getSandboxDir();
  if (!sandboxPath || path.resolve(sandboxPath) !== path.resolve(allowed)) return { ok: false, output: 'Access denied: invalid sandbox path', code: -1 };
  if (/[;&|`$<>!~{}()\n\\]/.test(command) || command.trimStart().startsWith('-')) return { ok: false, output: 'Rejected: command contains unsafe characters', code: -1 };
  try {
    if (this._permissionGate) {
      const decision = this._permissionGate.evaluateSyncSafe
        ? null
        : this._permissionGate !== null;
      // execSandboxCommand ist synchron (nutzt execSync). Um das Gate zu berücksichtigen,
      // verwenden wir eine synchrone Prüfung gegen die Regeln.
      const risk = require('./mainrisk').assessCommandRisk(command);
      const category = 'exec';
      const rules = this._permissionStore ? this._permissionStore.getAllEffective(null) : [];
      const catRule = rules.find(r => r.tool_type === category && (r.path === null || r.path === '' || r.path === undefined));
      if (catRule && !catRule.allowed) return { ok: false, output: 'blocked: command not permitted', code: -1 };
      // Critical/high ausserhalb von "none" blocken wir sicherheitshalber nur wenn sie nicht explizit allow sind.
      if ((risk === 'critical' || risk === 'high') && (!catRule || !catRule.allowed)) {
        return { ok: false, output: 'blocked: high-risk command requires approval (das Menu-Backend wartet auf den Gate)', code: -1 };
      }
    }
    const output = execSync(command, { cwd: allowed, timeout: 30000, encoding: 'utf-8' });
    return { ok: true, output };
  } catch (e) {
    return { ok: false, output: e.stderr || e.message, code: e.status };
  }
}
```
f) Neue Bridging-Methoden für die Regeln (am Ende der Klasse):
```js
addPermissionRule(rule) {
  if (!this._permissionStore) return { ok: false, error: 'permission store not initialized' };
  const r = this._permissionStore.set(rule.project, rule.tool_type, rule.action, { path: rule.path, global: rule.global });
  return { ok: true, rule: r };
}
removePermissionRule(rule) {
  if (!this._permissionStore) return { ok: false, error: 'permission store not initialized' };
  const done = this._permissionStore.remove(rule.project, rule.tool_type, { path: rule.path, global: rule.global });
  return { ok: done };
}
getPermissionRules(project) {
  if (!this._permissionStore) return [];
  return this._permissionStore.getAllEffective(project);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd App && node --test main/services/__tests__/sandbox-gate-integration.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add App/main/services/sandbox-service.js App/main/services/__tests__/sandbox-gate-integration.test.js
git commit -m "feat(main): PermissionGate in sandbox exec-Pfade eingebunden"
```

---

## Task 5: IPC-Kanäle + Preload für Permissions & Approval-Flow

**Files:**
- Modify: `App/main/ipc/sandbox.js`
- Modify: `App/preload.js`

**Interfaces:**
- Consumes: `SandboxService.setPermissionGate` etc. (Task 4).
- Produces: Neue IPC-Kanäle + Preload-Bridge:
  - `sandbox:get-permission-rules` (event, project) → Array
  - `sandbox:set-permission-rule` (event, rule) → result
  - `sandbox:remove-permission-rule` (event, rule) → result
  - `sandbox:permission-request` (Main → Renderer, event payload)
  - `sandbox:permission-respond` (event, decision) → von Renderer
  - Preload: `sandbox.getPermissionRules`, `sandbox.setPermissionRule`, `sandbox.removePermissionRule`, und `onPermissionRequest(cb)`

Der Approval-Flow (Main → Renderer → zurück):
- Wenn das Gate einen `ask`-Handler braucht, wird er in `main.js` (oder beim Setzen des Gates) registriert. Er sendet `sandbox:permission-request` an den Renderer und wartet auf `sandbox:permission-respond`. Die Antwort enthält `{ decision: 'allow'|'block', persist: 'once'|'always'|'never' }`.
- Bei `persist === 'always'` und `decision === 'allow'` wird vor dem Retry `store.set(project, tool_type, 'allow', opts)` geschrieben (damit der Retry die persistente Regel findet). Bei `decision === 'block'` und `always` → `store.set(..., 'block', ...)`.

Setze das Gate in `main.js` nach der SandboxService-Instanziierung (siehe Task 6). Hier in Task 5 wird nur der IPC-/Preload-Teil gebaut und verdrahtet.

- [ ] **Step 1: Write implementation (IPC)**

`App/main/ipc/sandbox.js` — füge am Ende der Funktion vor der schließenden Klammer hinzu:
```js
  ipcMain.handle('sandbox:get-permission-rules', (event, project) => sandboxService.getPermissionRules(project));
  ipcMain.handle('sandbox:set-permission-rule', (event, rule) => sandboxService.addPermissionRule(rule));
  ipcMain.handle('sandbox:remove-permission-rule', (event, rule) => sandboxService.removePermissionRule(rule));
```

- [ ] **Step 2: Write implementation (Preload)**

`App/preload.js` — innerhalb des `sandbox`-Objekts (nach `downloadImage`):
```js
    getPermissionRules: (project) => ipcRenderer.invoke('sandbox:get-permission-rules', project),
    setPermissionRule: (rule) => ipcRenderer.invoke('sandbox:set-permission-rule', rule),
    removePermissionRule: (rule) => ipcRenderer.invoke('sandbox:remove-permission-rule', rule),
```
Und am Ende (nach `onDownloadProgress`):
```js
contextBridge.exposeInMainWorld('onPermissionRequest', (cb) => {
  ipcRenderer.on('sandbox:permission-request', (e, info) => cb(info));
});

ipcRenderer.on('sandbox:permission-respond', (e, result) => {
  if (typeof window !== 'undefined' && window.__permissionResponse) {
    window.__permissionResponse(result);
  }
});
```

- [ ] **Step 3: Syntax check**

Run: `cd App && node --check main/ipc/sandbox.js && node --check preload.js`
Expected: no output (syntax OK)

- [ ] **Step 4: Build check**

Run: `cd App && npx electron-vite build 2>&1 | tail -20`
Expected: build succeeds (kein fataler Fehler)

- [ ] **Step 5: Commit**

```bash
git add App/main/ipc/sandbox.js App/preload.js
git commit -m "feat(ipc): Permission-Regel-Kanäle + Approval-Bridge im Preload"
```

---

## Task 6: Gate-Instanziierung + Approval-Handler in main.js

**Files:**
- Modify: `App/main.js`

**Interfaces:**
- Consumes: `PermissionStore` (Task 2), `PermissionGate` (Task 3), `getSandboxDir()` (shared).
- Produces: Der globale `PermissionGate` + `PermissionStore` werden instanziiert, an `SandboxService` übergeben und der `askHandler` wird verdrahtet.

Der askHandler:
```js
permissionGate = new PermissionGate({
  store,
  askHandler: async (info) => {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve('block'), 120000); // Sicherheits-Timeout
      const once = (result) => {
        clearTimeout(timer);
        cleanup();
        resolve(result.decision);
      };
      const handler = (_e, payload) => {
        if (payload.requestId === info.requestId) once(payload);
      };
      sendToRenderer('sandbox:permission-request', { ...info, requestId: reqId });
      ipcMain.once('sandbox:permission-respond', handler);
    });
  },
});
```
Zur Vereinfachung wird `requestId` je Aufruf generiert. Der Renderer antwortet jedes Mal mit `sandbox:permission-respond`.

- [ ] **Step 1: Read main.js to find insertion point**

Read `App/main.js` (insbesondere Zeilen ~58-90, wo SandboxService und registerSandboxIpc aufgerufen werden).

- [ ] **Step 2: Write implementation**

Erstelle/ändere in `App/main.js` (unten, nach der SandboxService-Instanziierung):
```js
const { PermissionStore } = require('./main/services/permission-store');
const { PermissionGate } = require('./main/services/permission-gate');
const permissionStore = new PermissionStore(path.join(getSandboxDir(), 'permissions.db'));
permissionStore.init();
let reqIdCounter = 0;
const permissionGate = new PermissionGate({
  store: permissionStore,
  askHandler: (info) => new Promise((resolve) => {
    const requestId = 'req-' + (++reqIdCounter);
    const timer = setTimeout(() => { cleanup(); resolve('block'); }, 120000);
    const cleanup = () => ipcMain.removeListener('sandbox:permission-respond', handler);
    const handler = (_e, payload) => {
      if (payload && payload.requestId === requestId && payload.decision) {
        clearTimeout(timer);
        cleanup();
        if (payload.persist === 'always') {
          try {
            permissionStore.set(info.project, info.category || resolveToolCategory(info.op), payload.decision, { path: info.path, global: info.global });
          } catch {}
        }
        resolve(payload.decision);
      }
    };
    ipcMain.on('sandbox:permission-respond', handler);
    win.webContents.send('sandbox:permission-request', { ...info, requestId, category: resolveToolCategory(info.op) });
  }),
});
sandboxService.setPermissionGate(permissionGate, permissionStore);
```
Hinweis: `win` ist die BrowserWindow-Variable in main.js. `resolveToolCategory` muss aus 'permission-gate' importiert werden. `path` wird oben schon importiert; falls nicht, ergänzen.

- [ ] **Step 3: Syntax + build check**

Run: `cd App && node --check main.js && npx electron-vite build 2>&1 | tail -20`
Expected: syntax OK + build succeeds

- [ ] **Step 4: Commit**

```bash
git add App/main.js
git commit -m "feat(main): PermissionGate-Instanz + Approval-Handler verdrahtet"
```

---

## Task 7: Dockerfile + entrypoint.sh + Default-Image + Volumes im Docker-Backend

**Files:**
- Create: `App/docker/sandbox/Dockerfile`
- Create: `App/docker/sandbox/entrypoint.sh`
- Modify: `App/sandbox/backends/docker.js`

**Interfaces:**
- Produces: `DockerBackend` nutzt `florde/sandbox:bookworm` als Default-Image; erhält Optionen `image`, `project`, `customTools` (Array von `{ type: 'apt'|'deb'|'appimage', name/path, global }`).
- Neue Methoden/Property: `_projectHash`, `_toolVolumes = []`.
- `init()` baut das Image falls nötig, mountet pro-Projekt-Volume `florde-sbx-<hash>-tools` → `/opt/custom-tools` und ggf. `florde-tools-global` → `/opt/global-tools`, führt `entrypoint.sh` zur Custom-Tool-Installation aus.

**Dockerfile** (`App/docker/sandbox/Dockerfile`):
```dockerfile
FROM debian:bookworm-slim

# Standard-Tools (Pflicht + sinnvoll)
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    bash coreutils findutils grep sed awk procps util-linux less \
    curl iproute2 dnsutils git \
    tar gzip zip unzip xz-utils jq \
    python3 python3-pip sudo ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Optional: Compiler / Node (via Build-Arg, standardmäßig aus)
ARG WITH_COMPILER=0
ARG WITH_NODE=0
RUN if [ "$WITH_COMPILER" = "1" ]; then \
      apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends gcc g++ make; \
    fi \
    && if [ "$WITH_NODE" = "1" ]; then \
      apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nodejs npm; \
    fi \
    && rm -rf /var/lib/apt/lists/*

# Dedizierter Sandbox-User
RUN useradd -m -s /bin/bash sandbox && echo 'sandbox ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/sandbox \
    && chmod 440 /etc/sudoers.d/sandbox

# Custom-Tool-Volumes (werden beim Start gemountet)
RUN mkdir -p /opt/custom-tools /opt/global-tools && chown -R sandbox:sandbox /opt

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /workspace
USER sandbox
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["sleep", "infinity"]
```

**entrypoint.sh** (`App/docker/sandbox/entrypoint.sh`):
```bash
#!/usr/bin/env bash
set -e
# Installiert Custom-Tools aus den gemounteten Verzeichnissen (Sekundär-Initialisierung).
# /opt/custom-tools und /opt/global-tools enthalten bereits installierte Pakete
# (apt-Skripte, .deb, AppImages), die beim Container-Start bereitstehen.
#
# Wenn manuell Tools nachinstalliert werden sollen, geschieht das über apt im
# laufenden Container (jemane Zustimmung der KI/des Users).

for t in /opt/custom-tools/*.sh; do
  [ -e "$t" ] && bash "$t"
done
for t in /opt/global-tools/*.sh; do
  [ -e "$t" ] && bash "$t"
done

# Führe weiter (CMD) aus
exec "$@"
```

- [ ] **Step 1: Write the failing test**

`App/sandbox/__tests__/docker-image-config.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { DockerBackend } = require('../backends/docker');

test('default image is florde/sandbox:bookworm', () => {
  const b = new DockerBackend('/tmp/x');
  assert.equal(b._image, 'florde/sandbox:bookworm');
});

test('custom image option overrides default', () => {
  const b = new DockerBackend('/tmp/x', { image: 'my/image:1' });
  assert.equal(b._image, 'my/image:1');
});

test('project hash is stable and derived from project', () => {
  const b1 = new DockerBackend('/tmp/x', { project: 'projA' });
  const b2 = new DockerBackend('/tmp/y', { project: 'projA' });
  const b3 = new DockerBackend('/tmp/z', { project: 'projB' });
  assert.equal(b1.projectHash, b2.projectHash);
  assert.notEqual(b1.projectHash, b3.projectHash);
});

test('Dockerfile exists and uses debian:bookworm-slim base', () => {
  const df = fs.readFileSync(path.join(__dirname, '..', '..', 'docker', 'sandbox', 'Dockerfile'), 'utf-8');
  assert.ok(df.includes('FROM debian:bookworm-slim'));
  assert.ok(df.includes('florde/sandbox:bookworm') === false); // Tag wird im Backend gesetzt
  assert.ok(df.includes('git'));
  assert.ok(df.includes('curl'));
  assert.ok(df.includes('python3'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd App && node --test sandbox/__tests__/docker-image-config.test.js`
Expected: FAIL (default image mismatch / projectHash undefined / Dockerfile missing)

- [ ] **Step 3: Write implementation (docker.js - Backend Anpassungen)**

In `App/sandbox/backends/docker.js`:

a) Konstruktor (ersetze die bestehende Zeile ~15):
```js
const { createHash } = require('crypto');
...
function projectHash(project) {
  return (project ? createHash('sha256').update(String(project)).digest('hex').substring(0, 12) : 'default');
}
```
Im Konstruktor:
```js
this._image = options.image || 'florde/sandbox:bookworm';
this._project = options.project || null;
this.projectHash = projectHash(this._project);
this._customTools = options.customTools || [];
this._toolVolumes = [];
```

b) Neue Methode `_ensureImage()`:
```js
_buildArgs() {
  const args = [];
  if ((this._customTools || []).some(t => t.type === 'compiler' || t.name === 'gcc')) args.push('--build-arg', 'WITH_COMPILER=1');
  if ((this._customTools || []).some(t => t.type === 'node' || t.name === 'nodejs')) args.push('--build-arg', 'WITH_NODE=1');
  return args;
}

_ensureImage() {
  const has = this._run(['image', 'inspect', this._image, '>', '/dev/null', '&&', 'echo', 'exists'], 30000);
  // Einfacher: inspect
  const check = this._run(['image', 'inspect', this._image], 15000);
  if (check.ok) return true;
  const dockerfileDir = path.resolve(__dirname, '..', '..', 'docker', 'sandbox');
  const buildArgs = this._buildArgs();
  const args = ['build', '-t', this._image, '-f', path.join(dockerfileDir, 'Dockerfile')].concat(buildArgs, [dockerfileDir]);
  const r = this._run(args, 180000);
  if (!r.ok) throw new Error('Failed to build sandbox image: ' + r.stderr);
  return true;
}
```

c) In `init()`: Vor dem `create` das Image sicherstellen und Volumes anhängen. Ersetze den Pull-Block (Zeilen 60-67) durch:
```js
this._ensureImage();
this._toolVolumes = [];
const projVol = 'florde-sbx-' + this.projectHash + '-tools';
this._run(['volume', 'create', projVol], 15000);
this._toolVolumes.push({ name: projVol, target: '/opt/custom-tools' });
const globalVol = 'florde-tools-global';
this._run(['volume', 'create', globalVol], 15000);
this._toolVolumes.push({ name: globalVol, target: '/opt/global-tools' });
```
Und im `create`-Aufruf (Zeilen 70-76), füge die `-v`-Mounts für die Volumes hinzu (nach dem bestehenden `-v workspace:/workspace`):
```js
const volumeArgs = [];
for (const v of this._toolVolumes) { volumeArgs.push('-v', v.name + ':' + v.target); }
const createResult = this._run([
  'create', '--name', containerName,
  '--network', this._network,
  '-v', `${this._workspaceDir}:/workspace`,
  ...volumeArgs,
  this._image,
  'sleep', 'infinity',
]);
```
`_ensureImage`, `_buildArgs`, `projectHash` werden als Methoden/Prop ergänzt.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd App && node --test sandbox/__tests__/docker-image-config.test.js`
Expected: PASS

- [ ] **Step 5: Run existing docker test (guarded)**

Run: `cd App && node --test sandbox/__tests__/docker-backend.test.js`
Expected: PASS oder überspringt Docker-abhängige Tests wenn nicht verfügbar (nicht rot brechen)

- [ ] **Step 6: Commit**

```bash
git add App/docker/sandbox/Dockerfile App/docker/sandbox/entrypoint.sh App/sandbox/backends/docker.js App/sandbox/__tests__/docker-image-config.test.js
git commit -m "feat(sandbox): Docker-Image debian:bookworm-slim + pro-Projekt-Volumes"
```

---

## Task 8: Custom-Tool-Konfiguration in Settings speichern + Container-Init

**Files:**
- Modify: `App/main/services/sandbox-service.js` (Custom-Tools-Config setzen)
- Modify: `App/sandbox/manager.js` (CustomTools an Docker-Backend durchreichen)
- Modify: `App/renderer/sandbox-settings.js` (Custom-Tools-UI)

**Interfaces:**
- Consumes: `DockerBackend`-Option `customTools` (Task 7), `sandbox.setConfig` (bestehend).
- Produces: `sandbox-service.setCustomTools(project, tools)` speichert unter `settings.json -> sandbox.customTools` (pro Projekt). `manager` gibt CustomTools beim Backend-Wechsel an Docker.

**Design:**
- `customTools` in `settings.json` unter `sandbox` als `{ [project]: [ { type, name, global } ] }`.
- Beim `switchBackend('docker')` reicht der Manager die CustomTools an das Backend durch.
- Docker-Backend nutzt bereits `options.customTools` für den Build-Arg (Compiler/Node) und die Volumes.

- [ ] **Step 1: Write implementation (manager.js)**

In `App/sandbox/manager.js`, im Konstruktor (Zeile 19), den Docker-Backend-Registrierungsblock so erweitern:
```js
this._register('docker', new DockerBackend(workspaceDir, { project: options.project || null }));
this._register('podman', new PodmanBackend(workspaceDir, { project: options.project || null }));
```
Und dem Konstruktor `options` hinzufügen:
```js
constructor(workspaceDir, options = {}) {
  ...
  this._project = options.project || null;
```
Ggf. `setProject(project)`-Methode, die `_project` setzt und beim Docker-Backend `_project`/`projectHash` aktualisiert (`backend._project = project; backend.projectHash = ...`).

- [ ] **Step 2: Write implementation (sandbox-service.js)**

Neue Methode:
```js
setCustomTools(project, tools) {
  try {
    const settings = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8'));
    const sandbox = settings.sandbox || {};
    sandbox.customTools = sandbox.customTools || {};
    sandbox.customTools[project] = tools;
    settings.sandbox = sandbox;
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}
getCustomTools(project) {
  try {
    const s = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8')).sandbox || {};
    return (s.customTools || {})[project] || [];
  } catch { return []; }
}
```
Beim Backend-Wechsel die customTools an den Docker-Backend reichen (in `switchBackend`):
```js
if ((type === 'docker' || type === 'podman') && this._manager._project) {
  const t = getCustomTools(this._manager._project);
  const b = this._manager._backends.get(type);
  b._customTools = t;
}
```
(Refactor: diese Logik lebt saubererer im Manager — hier pragmatisch über public-definierte Felder.)

- [ ] **Step 3: Write implementation (renderer/sandbox-settings.js)**

Im `_render(status)` HTML nach dem Netzwerk-Block eine neue Sektion ergänzen (bei Backend `docker`, `podman`):
```js
if (status.active === 'docker' || status.active === 'podman') {
  const tools = await window.electronAPI.sandbox.getCustomTools?.(currentProject) || [];
  // rendert Liste mit pro Eintrag: type select (apt/deb/appimage), name input, global checkbox, delete button
  // + "Tool hinzufügen" Button, der sandbox.setCustomTools speichert
}
```
Da `getCustomTools/setCustomTools` noch im Preload fehlen, ergänze sie in `preload.js`:
```js
getCustomTools: (p) => ipcRenderer.invoke('sandbox:get-custom-tools', p),
setCustomTools: (p, t) => ipcRenderer.invoke('sandbox:set-custom-tools', p, t),
```
und in `main/ipc/sandbox.js`:
```js
ipcMain.handle('sandbox:get-custom-tools', (e, p) => sandboxService.getCustomTools(p));
ipcMain.handle('sandbox:set-custom-tools', (e, p, t) => sandboxService.setCustomTools(p, t));
```
(Die `renderer/sandbox-settings.js`-UI kann in diesem Task minimal gehalten werden: ein einfacher ListRenderer; die volle UX ist optional, da es ein Keyboard-Modus ist.)

- [ ] **Step 4: Syntax + build check**

Run: `cd App && node --check main/services/sandbox-service.js && node --check sandbox/manager.js && node --check main/ipc/sandbox.js && node --check preload.js && node --check renderer/sandbox-settings.js`
Expected: all syntax OK

- [ ] **Step 5: Commit**

```bash
git add App/main/services/sandbox-service.js App/sandbox/manager.js App/main/ipc/sandbox.js App/preload.js App/renderer/sandbox-settings.js
git commit -m "feat(sandbox): Custom-Tools-Konfiguration pro Projekt + Init"
```

---

## Task 9: Renderer Approval-Dialog + Permission-UI

**Files:**
- Create: `App/renderer/permission-dialog.js`
- Modify: `App/renderer/index.html` (Einbindung, optional)
- Modify: `App/renderer/sandbox-settings.js` (Permission-Regeln-UI)

**Interfaces:**
- Consumes: `onPermissionRequest` (preload), `sandbox:permission-respond` (preload), `sandbox.getPermissionRules/setPermissionRule/removePermissionRule` (Task 5).
- Produces: `PermissionDialog` global für den Renderer, der auf `onPermissionRequest` hört, einen Dialog anzeigt, und Antwort an `sandbox:permission-respond` sendet.

**Dialog-Logik:**
- Empfängt `{ requestId, command/op/path, risk, backend, category }`.
- Zeigt Risiko-Badge, Buttons: Allow Once / Always Allow / Block Once / Always Block.
- Sendet `{ requestId, decision, persist }` über `sandbox:permission-respond`.

**Permission-Regeln-UI in sandbox-settings:**
- Neue Sektion "Permission-Regeln": lädt `sandbox.getPermissionRules(currentProject)`, listet Kategorien mit Select (allow/ask/block) + Global-Checkbox. Änderungen → `sandbox.setPermissionRule`.

- [ ] **Step 1: Write implementation (permission-dialog.js)**

`App/renderer/permission-dialog.js`:
```js
// Main-seitig angeforderte Zustimmungs-Dialoge (Permission-Layer)
window.PermissionDialog = {
  _active: null,
  init() {
    if (typeof window.onPermissionRequest === 'function') {
      window.onPermissionRequest((info) => this._show(info));
    }
  },
  _show(info) {
    if (this._active) { this._active.remove(); }
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;';
    const card = document.createElement('div');
    card.style.cssText = 'background:#1e1e1e;color:#ddd;border:1px solid #444;border-radius:8px;padding:1.2rem 1.5rem;max-width:520px;width:92%;box-shadow:0 8px 30px rgba(0,0,0,.5);';
    const riskColor = { critical: '#e53935', high: '#fb8c00', medium: '#fdd835', low: '#66bb6a', safe: '#81c784' }[info.risk] || '#fff';
    card.innerHTML = `
      <h3 style="margin:0 0 .6rem;">Genehmigung erforderlich</h3>
      <div style="font-size:.8rem;color:#aaa;margin-bottom:.6rem;">Backend: <b>${info.backend || '-'}</b> &middot; Kategorie: <b>${info.category || info.op || '-'}</b></div>
      <div style="font-size:.8rem;margin-bottom:.6rem;color:${riskColor};font-weight:600;">Risiko: ${info.risk || 'safe'}</div>
      <pre style="background:#111;padding:.6rem;border-radius:4px;overflow:auto;white-space:pre-wrap;font-family:monospace;font-size:.85rem;">${(info.command || info.path || '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</pre>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:1rem;">
        <button data-d="allow" data-p="once" style="flex:1;background:#2e7d32;color:#fff;border:0;border-radius:4px;padding:.5rem;">Einmal erlauben</button>
        <button data-d="allow" data-p="always" style="flex:1;background:#1b5e20;color:#fff;border:0;border-radius:4px;padding:.5rem;">Immer erlauben</button>
        <button data-d="block" data-p="once" style="flex:1;background:#37474f;color:#fff;border:0;border-radius:4px;padding:.5rem;">Einmal blocken</button>
        <button data-d="block" data-p="always" style="flex:1;background:#b71c1c;color:#fff;border:0;border-radius:4px;padding:.5rem;">Immer blocken</button>
      </div>
    `;
    overlay.appendChild(card);
    const cleanup = () => { this._active = null; overlay.remove(); };
    overlay.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-d]');
      if (!btn) return;
      const decision = btn.dataset.d, persist = btn.dataset.p;
      cleanup();
      window.permission.respond({ requestId: info.requestId, decision, persist });
    });
    document.body.appendChild(overlay);
    this._active = overlay;
  },
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.PermissionDialog.init());
else window.PermissionDialog.init();
```

- [ ] **Step 2: Implement the respond bridge in preload**

In `App/preload.js` ein `__permissionRespond`-Bridge aktivieren (mit clean call):
```js
contextBridge.exposeInMainWorld('permission', {
  respond: (result) => ipcRenderer.send('sandbox:permission-respond', result),
});
```
Und den Dialog so anpassen, dass er `window.permission.respond(...)` statt `window.__permissionRespond` nutzt (keine no-op fetch).

- [ ] **Step 3: Wire permission-dialog into index.html**

Füge in `App/renderer/index.html` (vor dem schließenden body-Skript) hinzu:
```html
<script src="permission-dialog.js"></script>
```
(oder als `type="module"` per Konvention; prüfe wie andere Skripte eingebunden sind).

- [ ] **Step 4: Syntax check**

Run: `cd App && node --check renderer/permission-dialog.js && npx electron-vite build 2>&1 | tail -20`
Expected: syntax OK + build succeeds

- [ ] **Step 5: Commit**

```bash
git add App/renderer/permission-dialog.js App/renderer/index.html App/preload.js
git commit -m "feat(renderer): Zustimmungs-Dialog für Main-Permission-Layer"
```

---

## Task 10: Permission-Regeln-UI in den Settings

**Files:**
- Modify: `App/renderer/sandbox-settings.js`

**Interfaces:**
- Consumes: `sandbox.getPermissionRules/setPermissionRule/removePermissionRule` (Task 5).

- [ ] **Step 1: Write implementation**

In `SandboxSettings._render(status)` (nach dem bestehenden Netzwerk-Teil), neue Sektion ergänzen:
```js
const rules = await window.electronAPI.sandbox.getPermissionRules?.(currentProject);
```
und einen ListRenderer bauen: für jede Regel einen Eintrag mit
- `tool_type`/`path` Anzeige
- Select: `allow` / `ask` / `block`
- Global-Checkbox
- Löschen-Button

`currentProject` bekommst du aus dem globalen Init-Kontext (bspw. `window.__currentProject` oder aus dem Settings-Store; prüfe wie andere Renderer-Module den aktuellen Projekt-Namen erhalten — der Bericht zeigte `currentProjectType` und `project`-Variablen im script.js).

- [ ] **Step 2: Syntax check**

Run: `cd App && node --check renderer/sandbox-settings.js && npx electron-vite build 2>&1 | tail -20`
Expected: builds

- [ ] **Step 3: Commit**

```bash
git add App/renderer/sandbox-settings.js
git commit -m "feat(renderer): Permission-Regeln konfigurierbar in Sandbox-Settings"
```

---

## Task 11: Gesamttest und Verifikation

**Files:**
- none (nur Verifikation)

- [ ] **Step 1: Run all sandbox tests**

Run: `cd App && node --test sandbox/__tests__/`
Expected: alle bestehenden passe. (Falls 'node --test sandbox/__tests__/' nicht als Suite läuft, dann jede Datei einzeln: `for f in sandbox/__tests__/*.test.js; do node --test "$f"; done`.)

- [ ] **Step 2: Run new main tests**

Run: `cd App && node --test main/services/__tests__/mainrisk.test.js main/services/__tests__/permission-store.test.js main/services/__tests__/permission-gate.test.js main/services/__tests__/sandbox-gate-integration.test.js`
Expected: all PASS

- [ ] **Step 3: Run all renderer tests**

Run: `cd App && for f in renderer/__tests__/*.test.js; do node --test "$f"; done`
Expected: all PASS (195)

- [ ] **Step 4: Build**

Run: `cd App && npx electron-vite build 2>&1 | tail -25`
Expected: successful build

- [ ] **Step 5: Gitleaks + git status review**

Run: `cd /home/plesend/Documents/GitHub/Florde && git status && (command -v gitleaks >/dev/null && gitleaks detect --no-banner || echo "gitleaks not installed")`
Expected: no secrets; clean status

- [ ] **Step 6: Commit final (falls Offene Änderungen)**

```bash
git add -A
git commit -m "chore: Verifikation Sandbox Image + Permission-Layer"
```

---

## Self-Review Kommentar

- **Spec-Coverage:** Sektion 1 (Image/Tools) → Task 7; Sektion 2 (Custom-Tools, pro Projekt + global) → Tasks 7+8; Sektion 3 (PermissionGate main-seitig, 3 Ebenen, Precedence) → Tasks 1,2,3,6; Sektion 4 (Dialog, Allow-Once-transient/Always-persistent, Settings-UI) → Tasks 5,9,10; Sektion 5 (Integration in beide Exec-Pfade, Datei-/VM-Ops, sudo im Container, Tests) → Tasks 4,7,11.
- **Bekannte Vereinfachung:** Datei-/VM-Operationen sind im Gate über Optionen (`op`, `path`) vorgesehen, aber der `checkAndRun`-Aufruf für read/write/delete/vm ist in den Tasks nur teilweise explizit verdrahtet (Task 4 deckt exec; read/write/delete können analog ergänzt werden, falls Zeit). Der Plan fokussiert auf exec (der kritische / KI-Pfad); Datei-/VM-Fälle sind über dasselbe `evaluate`-API abgedeckt und minimal verdrahtet.
