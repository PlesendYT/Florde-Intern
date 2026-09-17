# Dry Run Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Dry Run mode: agent tasks execute in an isolated temp workspace with op-log, diff review, and Apply/Reject/Continue.

**Architecture:** Session layer over the existing agent loop. `executeToolCall` (App/renderer/script.js:5178) becomes the single interception point: file paths are rewritten to the session root and commands go through classification + sandbox with temp cwd. New pure cores live in `App/renderer/domains/dryrun/` (ESM + `window.__dryrun*` bridge, following `domains/update/check.js` pattern); workspace provisioning lives in `App/main/services/dryrun-service.js` (CJS, following `db-service.js` pattern) with IPC endpoints.

**Tech Stack:** Electron renderer vanilla JS, Node main services, node:test (renderer ESM `import`, main CJS `require`), existing sandbox backends, existing diff viewer, existing permission gate.

## Global Constraints

- Chat tabu: no changes to chat message rendering, agent cards, or permission dialog visuals.
- No existing element id renamed or removed (shell-ids guard must stay green).
- No API keys/secrets in localStorage, settings.json, or logs.
- CSP `script-src 'self'`: no inline handlers, no eval (no-inline-handlers guard must stay green).
- Gitleaks before every commit; one commit per task.
- Existing suite must stay green (baseline 423 pass / 16 known permission fails from electron-ABI binary under system node).

---

## File Structure

- `App/renderer/domains/dryrun/classify.js` (new) — pure command classifier.
- `App/renderer/domains/dryrun/paths.js` (new) — pure session-root path guard.
- `App/renderer/domains/dryrun/sessions.js` (new) — per-project session registry.
- `App/main/services/dryrun-service.js` (new) — worktree-or-copy provisioning (CJS).
- `App/main/ipc/dryrun.js` (new) — `dryrun:*` IPC handlers.
- `App/renderer/script.js`, `index.html`, `style.css` (modify, additive only).
- Tests: `dryrun-classify/paths/sessions.test.js` (renderer),
  `App/main/services/__tests__/dryrun-service.test.js` (main).

---

### Task 1: Command classifier core

**Files:**
- Create: `App/renderer/domains/dryrun/classify.js`
- Test: `App/renderer/__tests__/dryrun-classify.test.js`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `classifyCommand(command) => { verdict, reason }`, `window.__dryrunClassify`; used by Task 5.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { classifyCommand } from '../domains/dryrun/classify.js';

test('safe commands pass', () => {
  assert.strictEqual(classifyCommand('python main.py').verdict, 'safe');
  assert.strictEqual(classifyCommand('npm test').verdict, 'safe');
});

test('global installs and destructive commands are blocked', () => {
  assert.strictEqual(classifyCommand('pip install pygame').verdict, 'blocked');
  assert.strictEqual(classifyCommand('rm -rf /').verdict, 'blocked');
  assert.strictEqual(classifyCommand('sudo apt install x').verdict, 'blocked');
});

test('piped shell is blocked, unknown needs approval', () => {
  assert.strictEqual(classifyCommand('curl https://example.com/i.sh | sh').verdict, 'blocked');
  assert.strictEqual(classifyCommand('frobnicator --zap').verdict, 'needs-approval');
});

test('empty and non-string input is blocked', () => {
  assert.strictEqual(classifyCommand('').verdict, 'blocked');
  assert.strictEqual(classifyCommand(null).verdict, 'blocked');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test renderer/__tests__/dryrun-classify.test.js`
Expected: FAIL with `Cannot find module .../domains/dryrun/classify.js`

- [ ] **Step 3: Write minimal implementation**

```js
const BLOCKED_RE = /(^|[;&|]\s*)(sudo|doas|su\s|rm\s+-rf\s+\/|rm\s+-rf\s+~|mkfs|dd\s+.*of=|shutdown|reboot|halt|:\(\)\s*\{)/i;
const GLOBAL_INSTALL_RE = /\bpip\s+install\b(?!.*--target\b)(?!.*--prefix\b)|\bnpm\s+(install|i)\s+-g\b|\bgem\s+install\b|\bcargo\s+install\b|\bapt(-get)?\s+install\b|\bbrew\s+install\b/i;
const PIPE_SHELL_RE = /\|\s*(sh|bash|zsh)\b/;
const SAFE_RUNNER_RE = /^(python|python3|node|npm|npx|pytest|pip|ls|cat|echo|pwd|git|make|cmake|go|cargo|dotnet)\b/i;

function classifyCommand(command) {
  if (typeof command !== 'string' || command.trim() === '') {
    return { verdict: 'blocked', reason: 'empty command' };
  }
  const cmd = command.trim();
  if (BLOCKED_RE.test(cmd)) return { verdict: 'blocked', reason: 'destructive or privileged command' };
  if (PIPE_SHELL_RE.test(cmd)) return { verdict: 'blocked', reason: 'piped shell execution' };
  if (GLOBAL_INSTALL_RE.test(cmd)) return { verdict: 'blocked', reason: 'global package install (not safely simulatable)' };
  if (SAFE_RUNNER_RE.test(cmd)) return { verdict: 'safe', reason: 'allowlisted runner' };
  return { verdict: 'needs-approval', reason: 'unknown command' };
}

export { classifyCommand };
export default { classifyCommand };
if (typeof window !== 'undefined') window.__dryrunClassify = { classifyCommand };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test renderer/__tests__/dryrun-classify.test.js`
Expected: PASS, 4/4

- [ ] **Step 5: Commit**

```bash
git add App/renderer/domains/dryrun/classify.js App/renderer/__tests__/dryrun-classify.test.js
gitleaks detect
git commit -m "feat(dry-run): command classifier core (safe/blocked/needs-approval)"
```

---

### Task 2: Path enforcement core

**Files:**
- Create: `App/renderer/domains/dryrun/paths.js`
- Test: `App/renderer/__tests__/dryrun-paths.test.js`

**Interfaces:**
- Consumes: nothing (pure; own posix normalize, no node dependency so it runs in renderer as-is).
- Produces: `resolveInRoot(root, userPath) => string|null`, `window.__dryrunPaths`; used by Task 5.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { resolveInRoot } from '../domains/dryrun/paths.js';

test('inside paths resolve, outside paths return null', () => {
  assert.strictEqual(resolveInRoot('/tmp/ws', 'main.py'), '/tmp/ws/main.py');
  assert.strictEqual(resolveInRoot('/tmp/ws', 'sub/dir.py'), '/tmp/ws/sub/dir.py');
  assert.strictEqual(resolveInRoot('/tmp/ws', '../evil.py'), null);
  assert.strictEqual(resolveInRoot('/tmp/ws', 'sub/../../evil.py'), null);
  assert.strictEqual(resolveInRoot('/tmp/ws', '/etc/passwd'), null);
  assert.strictEqual(resolveInRoot('/tmp/ws', ''), null);
});

test('tricky prefixes and dots do not escape', () => {
  assert.strictEqual(resolveInRoot('/tmp/ws', '../ws-evil/x.py'), null);
  assert.strictEqual(resolveInRoot('/tmp/ws', 'a/./b.py'), '/tmp/ws/a/b.py');
  assert.strictEqual(resolveInRoot('/tmp/ws', 'C:/evil.py'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test renderer/__tests__/dryrun-paths.test.js`
Expected: FAIL with `Cannot find module .../domains/dryrun/paths.js`

- [ ] **Step 3: Write minimal implementation**

```js
function normalizePosix(p) {
  const absolute = p.startsWith('/');
  const parts = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { parts.pop(); continue; }
    parts.push(seg);
  }
  return (absolute ? '/' : '') + parts.join('/');
}

function toPosixRoot(root) {
  let r = String(root || '').replace(/\\/g, '/');
  const drive = r.match(/^([A-Za-z]):\//);
  if (drive) r = '/' + drive[1].toLowerCase() + r.slice(3);
  if (!r.startsWith('/')) r = '/' + r;
  return r.replace(/\/+$/, '') || '/';
}

function resolveInRoot(root, userPath) {
  if (typeof userPath !== 'string' || userPath.trim() === '') return null;
  const base = toPosixRoot(root);
  const rel = String(userPath).replace(/\\/g, '/').trim();
  if (/^[A-Za-z]:\//.test(rel) || rel.startsWith('/')) return null;
  const resolved = normalizePosix(base + '/' + rel);
  if (resolved !== base && !resolved.startsWith(base + '/')) return null;
  return resolved;
}

export { resolveInRoot, normalizePosix };
export default { resolveInRoot, normalizePosix };
if (typeof window !== 'undefined') window.__dryrunPaths = { resolveInRoot, normalizePosix };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test renderer/__tests__/dryrun-paths.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add App/renderer/domains/dryrun/paths.js App/renderer/__tests__/dryrun-paths.test.js
gitleaks detect
git commit -m "feat(dry-run): session-root path enforcement core"
```

---

### Task 3: Per-project session registry

**Files:**
- Create: `App/renderer/domains/dryrun/sessions.js`
- Test: `App/renderer/__tests__/dryrun-sessions.test.js`

**Interfaces:**
- Consumes: injected `storage` with `get/set/del` (production adapter in Task 6).
- Produces: `createSessionRegistry(storage)` with `get/start/addOp/finish/apply/reject/listOrphans`, states `active|review`; used by Tasks 5–6.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { createSessionRegistry } from '../domains/dryrun/sessions.js';

function memStore() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), del: (k) => m.delete(k) };
}

test('one session per project, independent across projects', () => {
  const r = createSessionRegistry(memStore());
  r.start('projA', { path: '/tmp/a', kind: 'copy' });
  r.start('projB', { path: '/tmp/b', kind: 'worktree' });
  assert.strictEqual(r.get('projA').state, 'active');
  assert.strictEqual(r.get('projB').state, 'active');
  assert.throws(() => r.start('projA', { path: '/tmp/a2' }), /already active/);
});

test('op log, finish, apply lifecycle', () => {
  const r = createSessionRegistry(memStore());
  r.start('p', { path: '/tmp/w', kind: 'copy' });
  r.addOp('p', { kind: 'file', action: 'create', target: 'main.py', status: 'ok' });
  r.finish('p', { filesCreated: 1 });
  assert.strictEqual(r.get('p').state, 'review');
  assert.strictEqual(r.get('p').ops.length, 1);
  r.apply('p');
  assert.strictEqual(r.get('p'), null);
});

test('reject clears session, listOrphans finds unknown projects', () => {
  const r = createSessionRegistry(memStore());
  r.start('p', { path: '/tmp/w', kind: 'copy' });
  r.reject('p');
  assert.strictEqual(r.get('p'), null);
  const r2 = createSessionRegistry(memStore());
  r2.start('gone', { path: '/tmp/old', kind: 'copy' });
  assert.deepStrictEqual(r2.listOrphans(['other']), [{ project: 'gone', path: '/tmp/old', kind: 'copy' }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test renderer/__tests__/dryrun-sessions.test.js`
Expected: FAIL with `Cannot find module .../domains/dryrun/sessions.js`

- [ ] **Step 3: Write minimal implementation**

```js
function createSessionRegistry(storage) {
  const key = (project) => 'florde-dryrun:' + project;
  function get(project) {
    const raw = storage.get(key(project));
    return raw ? JSON.parse(raw) : null;
  }
  function put(project, session) {
    storage.set(key(project), JSON.stringify(session));
  }
  return {
    get,
    start(project, workspace) {
      if (get(project)) throw new Error('dry run already active for ' + project);
      const session = { project, state: 'active', workspace, ops: [], startedAt: Date.now(), summary: null };
      put(project, session);
      return session;
    },
    addOp(project, op) {
      const s = get(project);
      if (!s || s.state !== 'active') throw new Error('no active session for ' + project);
      s.ops.push({ at: Date.now(), ...op });
      put(project, s);
    },
    finish(project, summary) {
      const s = get(project);
      if (!s || s.state !== 'active') throw new Error('no active session for ' + project);
      s.state = 'review';
      s.summary = summary || null;
      put(project, s);
    },
    apply(project) {
      if (!get(project)) throw new Error('no session for ' + project);
      storage.del(key(project));
    },
    reject(project) {
      if (!get(project)) throw new Error('no session for ' + project);
      storage.del(key(project));
    },
    listOrphans(knownProjects) {
      const known = new Set(knownProjects || []);
      const out = [];
      const keys = typeof storage.keys === 'function' ? storage.keys() : [];
      for (const k of keys) {
        if (!k.startsWith('florde-dryrun:')) continue;
        const s = get(k.slice('florde-dryrun:'.length));
        if (s && !known.has(s.project)) out.push({ project: s.project, path: s.workspace.path, kind: s.workspace.kind });
      }
      return out;
    },
  };
}

export { createSessionRegistry };
export default { createSessionRegistry };
if (typeof window !== 'undefined') window.__dryrunSessions = { createSessionRegistry };
```

Note: `listOrphans` needs `storage.keys()` — extend the memStore in the test with `keys: () => [...m.keys()]`. Add that line to the test's memStore before implementing.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test renderer/__tests__/dryrun-sessions.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add App/renderer/domains/dryrun/sessions.js App/renderer/__tests__/dryrun-sessions.test.js
gitleaks detect
git commit -m "feat(dry-run): per-project session registry"
```

---

### Task 4: Workspace provisioning (main service + IPC)

**Files:**
- Create: `App/main/services/dryrun-service.js`
- Create: `App/main/ipc/dryrun.js`
- Modify: main IPC registration (where `db.js` etc. are required — add `dryrun.js` next to them)
- Test: `App/main/services/__tests__/dryrun-service.test.js`

**Interfaces:**
- Consumes: nothing new (uses `child_process.execFile` promisified, `fs.cpSync`).
- Produces: `DryRunService` with `start(projectName, {projectRoot}) => {ok, kind, path, branch, manifest}`, `cleanup(projectName, session) => {ok}`, `orphans() => [{path}]`; IPC `dryrun:start/status/finish/cleanup/orphans`; used by Task 5.

- [ ] **Step 1: Write the failing test**

```js
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DryRunService } = require('../dryrun-service');

describe('DryRunService copy workspace', () => {
  let tmp, proj, svc;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dryrun-'));
    proj = path.join(tmp, 'proj');
    fs.mkdirSync(path.join(proj, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'main.py'), 'print(1)');
    fs.writeFileSync(path.join(proj, 'sub', 'x.py'), 'x');
    fs.mkdirSync(path.join(proj, 'node_modules'));
    fs.writeFileSync(path.join(proj, 'node_modules', 'big.js'), 'x'.repeat(100));
    svc = new DryRunService({ tmpBase: path.join(tmp, 'ws') });
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('copies project minus excluded dirs with manifest', async () => {
    const r = await svc.start('p', { projectRoot: proj });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.kind, 'copy');
    assert.ok(fs.existsSync(path.join(r.path, 'main.py')));
    assert.ok(!fs.existsSync(path.join(r.path, 'node_modules')));
    assert.ok(r.manifest.some((f) => f.rel === 'main.py' && f.size === 8));
  });

  it('rejects missing project root', async () => {
    const r = await svc.start('p', { projectRoot: path.join(tmp, 'nope') });
    assert.strictEqual(r.ok, false);
  });

  it('cleanup removes the workspace', async () => {
    const r = await svc.start('p', { projectRoot: proj });
    await svc.cleanup('p', { workspace: { kind: r.kind, path: r.path } });
    assert.ok(!fs.existsSync(r.path));
  });

  it('orphans lists leftover workspaces', async () => {
    const r = await svc.start('p', { projectRoot: proj });
    const list = await svc.orphans();
    assert.ok(list.some((o) => o.path === r.path));
    await svc.cleanup('p', { workspace: { kind: r.kind, path: r.path } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test main/services/__tests__/dryrun-service.test.js` (from `App/`)
Expected: FAIL with `Cannot find module '../dryrun-service'`

- [ ] **Step 3: Write minimal implementation**

```js
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache']);
const MAX_MANIFEST_FILES = 5000;

async function buildManifest(root) {
  const files = [];
  const stack = [''];
  while (stack.length > 0 && files.length < MAX_MANIFEST_FILES) {
    const rel = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const childRel = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(childRel);
      } else if (e.isFile()) {
        let stat;
        try {
          stat = fs.statSync(path.join(root, childRel));
        } catch {
          continue;
        }
        files.push({ rel: childRel, size: stat.size, mtimeMs: stat.mtimeMs });
        if (files.length >= MAX_MANIFEST_FILES) break;
      }
    }
  }
  return files;
}

class DryRunService {
  constructor(options = {}) {
    this._tmpBase = options.tmpBase || path.join(os.tmpdir(), 'florde-dryrun');
    this._runGit = options.runGit || execFileAsync;
  }

  async _isGitRepo(dir) {
    try {
      await this._runGit('git', ['-C', dir, 'rev-parse', '--git-dir'], { timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }

  _workspaceDir(projectName) {
    const safe = String(projectName).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'project';
    return path.join(this._tmpBase, safe + '-' + Date.now());
  }

  async start(projectName, opts = {}) {
    const projectRoot = opts.projectRoot;
    if (!projectRoot || !fs.existsSync(projectRoot)) {
      return { ok: false, error: 'project root not found' };
    }
    const dest = this._workspaceDir(projectName);
    fs.mkdirSync(dest, { recursive: true });
    if (await this._isGitRepo(projectRoot)) {
      const branch = 'florde-dryrun-' + Date.now();
      try {
        await this._runGit('git', ['worktree', 'add', '--detach', dest, 'HEAD'], { cwd: projectRoot, timeout: 60000 });
      } catch (e) {
        return { ok: false, error: 'git worktree failed: ' + e.message };
      }
      return { ok: true, kind: 'worktree', path: dest, branch, manifest: await buildManifest(dest) };
    }
    try {
      fs.cpSync(projectRoot, dest, {
        recursive: true,
        filter: (src) => !SKIP_DIRS.has(path.basename(src)),
      });
    } catch (e) {
      return { ok: false, error: 'copy failed: ' + e.message };
    }
    return { ok: true, kind: 'copy', path: dest, branch: null, manifest: await buildManifest(dest) };
  }

  async cleanup(projectName, session) {
    const wsPath = session && session.workspace && session.workspace.path;
    try {
      if (session && session.workspace && session.workspace.kind === 'worktree') {
        await this._runGit('git', ['worktree', 'remove', '--force', wsPath], { timeout: 60000 }).catch(() => {});
      }
    } finally {
      if (wsPath) fs.rmSync(wsPath, { recursive: true, force: true });
    }
    return { ok: true };
  }

  async orphans() {
    let entries;
    try {
      entries = fs.readdirSync(this._tmpBase, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries.filter((e) => e.isDirectory()).map((e) => ({ path: path.join(this._tmpBase, e.name) }));
  }
}

module.exports = { DryRunService, SKIP_DIRS, MAX_MANIFEST_FILES };
```

IPC file `App/main/ipc/dryrun.js` (same shape as `db.js` — read that file first, then mirror):

```js
function registerDryRunIpc({ ipcMain, dryrunService }) {
  ipcMain.handle('dryrun:start', (event, projectName, opts) => dryrunService.start(projectName, opts));
  ipcMain.handle('dryrun:cleanup', (event, projectName, session) => dryrunService.cleanup(projectName, session));
  ipcMain.handle('dryrun:orphans', () => dryrunService.orphans());
}

module.exports = { registerDryRunIpc };
```

Wire it where the other `register*Ipc` calls live, and expose in preload next to the `sandbox` block:

```js
dryrun: {
  start: (projectName, opts) => ipcRenderer.invoke('dryrun:start', projectName, opts),
  cleanup: (projectName, session) => ipcRenderer.invoke('dryrun:cleanup', projectName, session),
  orphans: () => ipcRenderer.invoke('dryrun:orphans'),
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test main/services/__tests__/dryrun-service.test.js` (from `App/`)
Expected: PASS (worktree test uses a real `git init` repo — create it in the test with `execFileSync('git', ['init'])`; if git is missing, skip gracefully)

Note: add a git-worktree subtest — in `beforeEach`, run `git init`, `git add -A`, `git commit` (with `-c user.email=t@t -c user.name=t`) in a second fixture dir, then assert `start` returns `kind: 'worktree'` and the file is present. If `git` binary is absent, `this.skip()`.

- [ ] **Step 5: Commit**

```bash
git add App/main/services/dryrun-service.js App/main/ipc/dryrun.js App/main/services/__tests__/dryrun-service.test.js App/preload.js
gitleaks detect
git commit -m "feat(dry-run): worktree-or-copy workspace provisioning + IPC"
```

(App/main.js or wherever IPC registers — include that file in the commit if touched; check `git status` before committing and add it.)

---

### Task 5: Tool interception + op-log (the session layer)

**Files:**
- Modify: `App/renderer/script.js` (in/around `executeToolCall`, script.js:5178)
- Test: extend `App/renderer/__tests__/chat-sessions.test.js`? No — interception needs DOM/project; instead add `App/renderer/__tests__/dryrun-intercept.test.js` testing a small extracted helper `buildSessionRewrite(sessionRoot, toolName, args)` placed in `App/renderer/domains/dryrun/rewrite.js` (pure: returns `{ args, denied? }`).

**Interfaces:**
- Consumes: Tasks 1–4 (`classifyCommand`, `resolveInRoot`, session registry shape, `dryrun:*` IPC).
- Produces: op-log entries `{at, kind, action, target, status, detail}` in session; used by Task 6.

- [ ] **Step 1: Write the failing test** (`rewrite.js` pure helper)

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { rewriteForSession } from '../domains/dryrun/rewrite.js';

test('file paths rewrite into session root, escapes denied', () => {
  const ok = rewriteForSession('/tmp/ws', 'write_file', { path: 'main.py' });
  assert.deepStrictEqual(ok.args, { path: '/tmp/ws/main.py' });
  const bad = rewriteForSession('/tmp/ws', 'write_file', { path: '../evil.py' });
  assert.strictEqual(bad.denied, true);
});

test('exec commands classify, blocked never passes', () => {
  const blocked = rewriteForSession('/tmp/ws', 'exec_command', { command: 'pip install pygame' });
  assert.strictEqual(blocked.denied, true);
  assert.match(blocked.reason, /global package install/);
  const safe = rewriteForSession('/tmp/ws', 'exec_command', { command: 'python main.py' });
  assert.strictEqual(safe.denied, undefined);
  assert.strictEqual(safe.cwd, '/tmp/ws');
});

test('read-only tools pass through with rewritten path', () => {
  const r = rewriteForSession('/tmp/ws', 'read_file', { path: 'a.py' });
  assert.deepStrictEqual(r.args, { path: '/tmp/ws/a.py' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test renderer/__tests__/dryrun-intercept.test.js`
Expected: FAIL with `Cannot find module .../domains/dryrun/rewrite.js`

- [ ] **Step 3: Write minimal implementation** (`rewrite.js`)

```js
function rewriteForSession(sessionRoot, toolName, args, classify) {
  const classifyFn = classify || ((cmd) => ({ verdict: 'safe', reason: 'no classifier' }));
  const FILE_TOOLS = ['read_file', 'write_file', 'edit_file', 'delete_file', 'list_files', 'search_files', 'rename_file'];
  if (toolName === 'exec_command') {
    const command = args && args.command;
    const verdict = classifyFn(typeof command === 'string' ? command : '');
    if (verdict.verdict === 'blocked') return { denied: true, reason: verdict.reason };
    if (verdict.verdict === 'needs-approval') return { denied: true, reason: 'needs approval: ' + verdict.reason, approval: true };
    return { args, cwd: sessionRoot };
  }
  if (FILE_TOOLS.includes(toolName)) {
    const out = { ...(args || {}) };
    if (out.path !== undefined) {
      // NOTE: renderer paths are project-relative; containment is enforced
      // against the session root via a posix check mirrored from paths.js.
      // Full enforcement happens in executeToolCall (Task 5 wiring) which
      // rejects null resolutions before any IPC call.
      out.path = sessionRoot.replace(/\/+$/, '') + '/' + String(out.path).replace(/^\/+/, '');
      if (out.path.includes('/../') || /(^|\/)\.\.(\/|$)/.test(String(args.path))) {
        return { denied: true, reason: 'path escapes session root' };
      }
    }
    return { args: out };
  }
  return { args };
}
```

Wait — the `..` check above is redundant with paths.js. Simplify: `rewrite.js` must USE `resolveInRoot` from paths.js. These are ESM modules in the same folder — import directly:

Replace the FILE_TOOLS branch with:

```js
import { resolveInRoot } from './paths.js';
...
  if (FILE_TOOLS.includes(toolName)) {
    const out = { ...(args || {}) };
    if (out.path !== undefined) {
      const resolved = resolveInRoot(sessionRoot, out.path);
      if (resolved === null) return { denied: true, reason: 'path escapes session root' };
      out.path = resolved;
    }
    return { args: out };
  }
```

(Use this import version, not the inline-check version.)

- [ ] **Step 4: Wire into `executeToolCall`** (script.js:5178, after the permission check, before `setActivity`):

```js
const __drySession = (typeof DryRun !== 'undefined' && DryRun.activeFor)
  ? DryRun.activeFor(project)
  : null;
if (__drySession) {
  const { rewriteForSession } = window.__dryrunRewrite;
  const cls = window.__dryrunClassify ? window.__dryrunClassify.classifyCommand : undefined;
  const rw = rewriteForSession(__drySession.workspace.path, name, args, cls);
  if (rw.denied) {
    DryRun.logOp(project, { kind: name === 'exec_command' ? 'command' : 'file', action: name, target: (args && (args.path || args.command)) || '', status: rw.approval ? 'approval' : 'denied', detail: rw.reason });
    if (rw.approval) {
      const ok = confirm('Dry Run: allow "' + ((args && (args.path || args.command)) || name) + '"? (' + rw.reason + ')');
      if (!ok) throw new Error('Dry run command needs approval and was declined');
    } else {
      throw new Error('Dry run blocked: ' + rw.reason);
    }
  } else {
    args = rw.args;
    if (name === 'exec_command' && rw.cwd) {
      // execDir is computed a few lines below as `const execDir = ...` —
      // override it: change that line to prefer the session cwd:
      // const execDir = __drySession ? __drySession.workspace.path : (currentProjectType === 'local' ? ... : sandboxDir);
    }
  }
}
```

Concretely: (a) add the block above right after `if (!allowed) {...}` and before `setActivity(...)`; (b) change the `execDir` line in the `exec_command` case to prefer `__drySession.workspace.path`; (c) after each tool result/throw in Dry Run, call `DryRun.logOp(project, {...})` for file creates/modifies/deletes with status ok/error — hook the three file cases minimally (one log line each, reusing existing success/error paths); (d) implement the `DryRun` controller object (new small section near the mode toggle, ~80 lines): `activeFor(project)` reading the Task-3 registry, `start(project)` calling `dryrun:start` IPC + registry, `logOp`, `finish`, plus venv note: on session start, if the project looks like Python (requirements.txt/pyproject.toml present), prepend `python -m venv` guidance into the session context message (no auto-venv; document why: creating one unasked would surprise).

- [ ] **Step 5: Run tests**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test renderer/__tests__/dryrun-intercept.test.js`
Expected: PASS. Then full suite: `npm test` (from `App/`) — only the 16 known fails allowed.

- [ ] **Step 6: Commit**

```bash
git add App/renderer/domains/dryrun/rewrite.js App/renderer/__tests__/dryrun-intercept.test.js App/renderer/script.js
gitleaks detect
git commit -m "feat(dry-run): tool interception with op-log in executeToolCall"
```

---

### Task 6: Mode toggle, header, review/apply UI

**Files:**
- Modify: `App/renderer/index.html` (additive: third toggle state — reuse `btn-agentic-mode`, add `agentic-dryrun` class handling; add `#dryrun-badge` in chat header; add review panel container `#dryrun-review` + buttons `data-dryrun="apply|reject|continue"`)
- Modify: `App/renderer/style.css` (badge/panel/buttons, tokens only, no shadows, radius ≤ 8px)
- Modify: `App/renderer/script.js` (toggle cycling Build→Plan→Dry Run, header render, summary + diff render into existing diff viewer, apply with conflict check + per-file delete confirm, orphan prompt at startup)
- Test: extend shell-ids guard implicitly (new ids must exist — the guard enforces it automatically); no new test file needed, but add one assertion to an existing suitable test? No — keep guard green and verify manually per below.

**Interfaces:**
- Consumes: Tasks 3–5 (registry, interception, IPC, diff viewer).
- Produces: visible Dry Run UX; used by Task 7 verification.

- [ ] **Step 1: Toggle + header (no test-first possible for DOM — verify via guard + manual)**

In the `btn-agentic-mode` click handler (script.js:4556), extend the two-state toggle to three states. Exact replacement:

```js
document.getElementById('btn-agentic-mode').addEventListener('click', () => {
  const btn = document.getElementById('btn-agentic-mode');
  const order = ['build', 'plan', 'dryrun'];
  const labels = { build: 'Build', plan: 'Plan', dryrun: 'Dry Run' };
  const titles = {
    build: 'Build mode: AI executes directly',
    plan: 'Plan mode: AI plans first, you approve',
    dryrun: 'Dry Run mode: isolated test run, nothing touches the real project',
  };
  const current = localStorage.getItem('florde-agent-mode') || 'build';
  const next = order[(order.indexOf(current) + 1) % order.length];
  btn.classList.toggle('agentic-plan', next === 'plan');
  btn.classList.toggle('agentic-build', next === 'build');
  btn.classList.toggle('agentic-dryrun', next === 'dryrun');
  btn.textContent = labels[next];
  btn.title = titles[next];
  localStorage.setItem('florde-agent-mode', next);
  if (typeof DryRun !== 'undefined') DryRun.onModeChange(next);
});
```

Also update the restore block (~script.js:2670) to handle `'dryrun'` the same way (set class/label/title from stored value).

Header badge: in the chat panel header add `<span id="dryrun-badge" class="dryrun-badge hidden"></span>`; `DryRun.renderHeader(project)` sets text `DRY RUN · <temp path>` or hides. CSS:

```css
.dryrun-badge { font-size: 0.72rem; font-weight: 600; color: var(--accent-ink, #fff); background: var(--accent); border-radius: 6px; padding: 2px 8px; }
```

- [ ] **Step 2: Review panel + three actions**

Container (initially hidden) with `#dryrun-summary`, `#dryrun-ops`, and buttons Apply to Project / Reject / Modify–Continue (use `data-dryrun` attributes + one delegated listener — CSP-safe, no inline handlers). Summary line format: `X files created · Y files modified · Z commands executed` plus ⚠/✖ lines for failures. Diff: reuse existing diff viewer functions with session-vs-snapshot file pairs (created/modified/deleted + content hunks).

Apply flow (exact order): (1) conflict check — for each changed file, compare real file mtime/size against snapshot manifest from session start; on mismatch, `confirm()` per file (skip on decline); (2) copy created/modified via existing project write IPC; (3) deletes only after individual `confirm()`; (4) registry `apply()` + IPC `dryrun:cleanup`. Reject: registry `reject()` + cleanup, no copies. Continue: leave session active, focus chat input.

- [ ] **Step 3: Verify**

Run: full `npm test` from `App/` (only 16 known fails); `node --check renderer/script.js`; guard green (new ids present by construction — the shell-ids test fails otherwise); manual click path: toggle cycles 3 states, badge shows/hides per project, review buttons render.

- [ ] **Step 4: Commit**

```bash
git add App/renderer/index.html App/renderer/style.css App/renderer/script.js
gitleaks detect
git commit -m "feat(dry-run): mode toggle, header badge, review/apply UI"
```

---

### Task 7: End-to-end verification + cleanup

**Files:** none (verification only) unless fixes are needed.

- [ ] **Step 1: Run the full suite**

Run: `npm test` from `App/`
Expected: 423+ new passing tests, only the 16 known permission fails.

- [ ] **Step 2: Manual dry-run pass with `none` backend**

In the app: backend `none`, non-git scratch project → Dry Run toggle → ask for `main.py` + `pip install pygame` + `python main.py` → expect: files land in temp workspace only (real project untouched), pip classified blocked-or-venv, summary + diff render, Apply copies files, Reject cleans temp dir.

- [ ] **Step 3: Guards + hygiene**

Run: `gitleaks detect`; `git status` (only intended files per task); confirm no `console.log` leftovers in new code; confirm `.gitignore` covers temp workspaces (they live in `os.tmpdir()`, outside the repo — nothing to add).

- [ ] **Step 4: Final commit only if fixes were needed**

If verification passes clean, no commit. Otherwise fix + `git commit -m "fix(dry-run): ..."`.

---

## Self-Review

1. **Spec coverage:** §1 toggle/lifecycle → Task 6; per-project sessions → Task 3. §2 worktree-or-copy + manifest → Task 4; session root + cwd → Task 5; cleanup + orphans → Tasks 4–6 (orphan startup prompt wired in Task 6 verify). §3 interceptor + op-log → Task 5; classifier → Task 1; backend + venv → Task 5. §4 summary + diff + 3 buttons → Task 6; copy-apply + delete confirm + conflict check → Task 6; continue → Task 6. §5 guarantees → Tasks 1–6 as mapped; tests → every task + Task 7.
2. **Placeholder scan:** fixed during writing — Task 4 has full service code, Task 5 has the exact insertion block, Task 6 has exact toggle code; no TBD/TODO/"similar to".
3. **Type consistency:** `classifyCommand` → `{verdict, reason}` (Tasks 1, 5 match); `resolveInRoot(root, userPath)` (Tasks 2, 5 match); registry API `get/start/addOp/finish/apply/reject/listOrphans` (Tasks 3, 5, 6 match); service `start → {ok, kind, path, branch, manifest}`, `cleanup`, `orphans` (Tasks 4–6 match); IPC `dryrun:start/cleanup/orphans` (Tasks 4–6 match).

