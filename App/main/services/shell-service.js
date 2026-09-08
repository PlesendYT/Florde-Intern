const fs = require('fs');
const path = require('path');
const { net, safeStorage } = require('electron');
const { spawn, spawnSync } = require('child_process');

let ptySpawn = null;
try { ptySpawn = require('node-pty').spawn; } catch { ptySpawn = null; }

class ShellService {
  constructor() {
    this._terminalProcesses = {};
    this._terminalIdCounter = 0;
    this._mcpServerProcesses = new Map();
  }

  // ============= WEB SEARCH =============
  async webSearch(query, numResults = 5) {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const html = await new Promise((resolve, reject) => {
        const req = net.request(url);
        let data = '';
        req.on('response', (res) => {
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => resolve(data));
          res.on('error', reject);
        });
        req.on('error', reject);
        req.end();
      });
      const results = [];
      const regex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = regex.exec(html)) !== null && results.length < numResults) {
        const title = m[2].replace(/<[^>]+>/g, '').trim();
        const url2 = m[1];
        if (title && url2 && !url2.includes('duckduckgo.com')) {
          results.push({ title, url: url2 });
        }
      }
      return results.slice(0, numResults);
    } catch (err) {
      return { error: err.message };
    }
  }

  // ============= GIT =============
  // Security (F1-F4): never build shell strings. All git invocations use
  // spawnSync with shell:false plus strict allowlist validation.
  _gitRun(repoPath, args, timeout = 10000) {
    if (typeof repoPath !== 'string' || !repoPath || /[\0\n\r]/.test(repoPath)) {
      throw new Error('Invalid repo path');
    }
    const resolved = path.resolve(repoPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error('Repo path does not exist');
    }
    const r = spawnSync('git', args, { cwd: resolved, timeout, encoding: 'utf-8', shell: false });
    if (r.error) throw r.error;
    return r;
  }

  _assertGitRef(name) {
    if (typeof name !== 'string' || name.length === 0 || name.length > 100) {
      throw new Error('Invalid git ref');
    }
    if (/[\0\n\r\s;|&$`<>"'\\!(){}\[\]*?~#]/.test(name)) throw new Error('Invalid git ref');
    if (name.startsWith('-') || name.startsWith('/') || name.includes('..') || name.includes('//')) {
      throw new Error('Invalid git ref');
    }
    return name;
  }

  _assertRepoFile(repoPath, filePath) {
    if (typeof filePath !== 'string' || !filePath || filePath.length > 500) {
      throw new Error('Invalid file path');
    }
    if (/[\0\n\r]/.test(filePath)) throw new Error('Invalid file path');
    if (path.isAbsolute(filePath)) throw new Error('Absolute paths not allowed');
    const resolved = path.resolve(repoPath, filePath);
    const root = path.resolve(repoPath) + path.sep;
    if (resolved !== path.resolve(repoPath) && !resolved.startsWith(root)) {
      throw new Error('Path escapes repo');
    }
    return filePath;
  }

  gitStatus(repoPath) {
    try {
      const r = this._gitRun(repoPath, ['status', '--porcelain']);
      return (r.stdout || '').trim();
    } catch { return ''; }
  }

  gitDiff(repoPath) {
    try {
      const r = this._gitRun(repoPath, ['diff']);
      return r.stdout || '';
    } catch { return ''; }
  }

  gitCommit(repoPath, name, description) {
    try {
      const title = String(name || '');
      const body = String(description || '');
      if (/[\0]/.test(title + body)) return { ok: false, error: 'Invalid commit message' };
      if (title.length > 500 || body.length > 5000) return { ok: false, error: 'Commit message too long' };
      const r = this._gitRun(repoPath, ['commit', '-m', title, '-m', body]);
      if (r.status !== 0) return { ok: false, error: r.stderr || r.stdout };
      return { ok: true, output: r.stdout };
    } catch (e) { return { ok: false, error: e.stderr || e.message }; }
  }

  gitBranchList(repoPath) {
    try {
      const r = this._gitRun(repoPath, ['branch', '-a']);
      return (r.stdout || '').trim().split('\n').map(l => l.trim()).filter(Boolean);
    } catch { return []; }
  }

  gitBranchCreate(repoPath, name) {
    try {
      this._assertGitRef(name);
      const r = this._gitRun(repoPath, ['branch', name]);
      if (r.status !== 0) return { ok: false, error: r.stderr || r.stdout };
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  gitBranchDelete(repoPath, name) {
    try {
      this._assertGitRef(name);
      const r = this._gitRun(repoPath, ['branch', '-d', name]);
      if (r.status !== 0) return { ok: false, error: r.stderr || r.stdout };
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  gitCheckout(repoPath, name) {
    try {
      this._assertGitRef(name);
      const r = this._gitRun(repoPath, ['checkout', name]);
      if (r.status !== 0) return { ok: false, error: r.stderr || r.stdout };
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  static _GIT_EXEC_ALLOW = new Set([
    'status', 'diff', 'log', 'branch', 'blame', 'show', 'ls-files',
    'rev-parse', 'remote', 'tag', 'stash', 'checkout', 'add', 'commit',
    'reset', 'clean', 'fetch', 'describe',
  ]);

  gitExec(repoPath, args) {
    try {
      if (!Array.isArray(args) || args.length === 0 || args.length > 20) {
        return { ok: false, error: 'Invalid git args' };
      }
      const [sub, ...rest] = args.map(String);
      if (!ShellService._GIT_EXEC_ALLOW.has(sub)) return { ok: false, error: 'Git subcommand not allowed' };
      for (const a of args.map(String)) {
        if (a.length > 300 || /[\0\n\r;|&$`<>"'\\!(){}\[\]*?~#]/.test(a)) {
          return { ok: false, error: 'Invalid git argument' };
        }
      }
      // Dangerous flags never via generic exec
      if (rest.includes('--exec') || rest.includes('--upload-pack') || rest.includes('--receive-pack')) {
        return { ok: false, error: 'Flag not allowed' };
      }
      const r = this._gitRun(repoPath, args.map(String));
      if (r.status !== 0) return { ok: false, error: r.stderr || r.stdout };
      return { ok: true, output: r.stdout };
    } catch (e) { return { ok: false, error: e.stderr || e.message }; }
  }

  gitLog(repoPath, limit = 50) {
    try {
      const n = Math.min(500, Math.max(1, parseInt(limit, 10) || 50));
      const r = this._gitRun(repoPath, ['log', '--oneline', '-n', String(n)]);
      return (r.stdout || '').trim().split('\n').filter(Boolean);
    } catch { return []; }
  }

  gitBlame(repoPath, filePath) {
    try {
      this._assertRepoFile(repoPath, filePath);
      const r = this._gitRun(repoPath, ['blame', '--', filePath]);
      return r.stdout || '';
    } catch { return ''; }
  }

  gitDiffFile(repoPath, filePath) {
    try {
      this._assertRepoFile(repoPath, filePath);
      const r = this._gitRun(repoPath, ['diff', '--', filePath]);
      return r.stdout || '';
    } catch { return ''; }
  }

  gitPush(repoPath, remote = 'origin', branch) {
    try {
      let b = branch;
      if (!b) {
        const r0 = this._gitRun(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
        b = (r0.stdout || '').trim();
      }
      this._assertGitRef(b);
      const allowedRemote = /^[A-Za-z0-9._-]+$/;
      const rmt = allowedRemote.test(String(remote)) ? String(remote) : 'origin';
      const r = spawnSync('git', ['push', rmt, b], { cwd: path.resolve(repoPath), timeout: 30000, encoding: 'utf-8', shell: false });
      if (r.error) throw r.error;
      if (r.status !== 0) return { ok: false, error: r.stderr || r.stdout };
      return { ok: true };
    } catch (e) { return { ok: false, error: e.stderr || e.message }; }
  }

  gitPull(repoPath, remote = 'origin', branch) {
    try {
      let b = branch;
      if (!b) {
        const r0 = this._gitRun(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
        b = (r0.stdout || '').trim();
      }
      this._assertGitRef(b);
      const allowedRemote = /^[A-Za-z0-9._-]+$/;
      const rmt = allowedRemote.test(String(remote)) ? String(remote) : 'origin';
      const r = spawnSync('git', ['pull', rmt, b], { cwd: path.resolve(repoPath), timeout: 30000, encoding: 'utf-8', shell: false });
      if (r.error) throw r.error;
      if (r.status !== 0) return { ok: false, error: r.stderr || r.stdout };
      return { ok: true };
    } catch (e) { return { ok: false, error: e.stderr || e.message }; }
  }

  // ============= DOCKER =============
  _dockerExec(args, timeout = 30000, cwd) {
    try {
      const opts = { timeout, encoding: 'utf-8' };
      if (cwd) opts.cwd = cwd;
      const r = spawnSync('docker', args, opts);
      if (r.error) throw r.error;
      return { ok: true, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
    } catch (e) {
      return { ok: false, error: e.stderr || e.message };
    }
  }

  dockerInfo() {
    const r = this._dockerExec(['info', '--format', '{{.ServerVersion}}']);
    return r.ok ? { ok: true, version: r.stdout } : { ok: false, error: r.error };
  }

  dockerPs() {
    const r = this._dockerExec(['ps', '-a', '--format', '{{.ID}}|{{.Image}}|{{.Names}}|{{.Status}}|{{.Ports}}|{{.CreatedAt}}']);
    if (!r.ok) return { ok: false, error: r.error };
    const containers = r.stdout.split('\n').filter(Boolean).map(line => {
      const [id, image, names, status, ports, createdAt] = line.split('|');
      const running = status && status.toLowerCase().startsWith('up');
      return { id: id ? id.substring(0, 12) : '', image: image || '', name: names || '', status: status || '', ports: ports || '', createdAt: createdAt || '', running };
    });
    return { ok: true, containers };
  }

  dockerImages() {
    const r = this._dockerExec(['images', '--format', '{{.Repository}}|{{.Tag}}|{{.ID}}|{{.Size}}|{{.CreatedAt}}']);
    if (!r.ok) return { ok: false, error: r.error };
    const images = r.stdout.split('\n').filter(Boolean).map(line => {
      const [repository, tag, id, size, createdAt] = line.split('|');
      return { repository: repository || '', tag: tag || '', id: id ? id.substring(0, 12) : '', size: size || '', createdAt: createdAt || '' };
    });
    return { ok: true, images };
  }

  dockerStart(id) {
    const r = this._dockerExec(['start', id]);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }

  dockerStop(id) {
    const r = this._dockerExec(['stop', id]);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }

  dockerRestart(id) {
    const r = this._dockerExec(['restart', id]);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }

  dockerLogs(id, lines = 50) {
    const r = this._dockerExec(['logs', '--tail', String(lines), id]);
    return r.ok ? { ok: true, logs: r.stdout } : { ok: false, error: r.error };
  }

  dockerComposeUp(filePath) {
    const dir = path.dirname(filePath);
    return this._dockerExec(['compose', '-f', filePath, 'up', '-d'], 30000, dir);
  }

  dockerComposeDown(filePath) {
    const dir = path.dirname(filePath);
    return this._dockerExec(['compose', '-f', filePath, 'down'], 30000, dir);
  }

  dockerComposeLogs(filePath) {
    const dir = path.dirname(filePath);
    return this._dockerExec(['compose', '-f', filePath, 'logs', '--tail=100'], 30000, dir);
  }

  // ============= OLLAMA =============
  async _ollamaApi(path) {
    return new Promise((resolve, reject) => {
      const req = net.request('http://localhost:11434' + path);
      let data = '';
      req.on('response', (res) => {
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve(data));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end();
    });
  }

  async ollamaList() {
    try {
      const data = await this._ollamaApi('/api/tags');
      return JSON.parse(data);
    } catch (e) { return { models: [] }; }
  }

  async ollamaPull(modelName) {
    try {
      const data = await this._ollamaApi('/api/pull');
      return { ok: true, data };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  async ollamaDelete(modelName) {
    try {
      const data = await this._ollamaApi('/api/delete');
      return { ok: true, data };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  async ollamaShow(modelName) {
    try {
      const data = await this._ollamaApi('/api/show');
      return JSON.parse(data);
    } catch (e) { return { error: e.message }; }
  }

  async ollamaPs() {
    try {
      const data = await this._ollamaApi('/api/ps');
      return JSON.parse(data);
    } catch (e) { return { processes: [] }; }
  }

  // ============= MCP SERVER SPAWN =============
  // Security (F5/b-14): never spawn with shell:true. Only bare runtime names
  // from a fixed allowlist, resolved via PATH (no / or \ tricks, no tmp-dir
  // binaries). npx/uvx are excluded: they fetch remote code on demand.
  static _MCP_ALLOW_BIN = new Set([
    'node', 'python', 'python3', 'bun', 'deno',
  ]);

  _resolveMcpBin(bin) {
    const name = String(bin || '').trim();
    if (!name || name.length > 100 || /[\0\n\r\s;|&$`<>"'\\!(){}\[\]*?~#\/]/.test(name)) {
      throw new Error('Invalid MCP executable');
    }
    if (!ShellService._MCP_ALLOW_BIN.has(name)) {
      throw new Error('MCP executable not allowed: ' + name);
    }
    const probe = process.platform === 'win32' ? 'where' : 'which';
    const r = spawnSync(probe, [name], { encoding: 'utf-8', shell: false, timeout: 5000 });
    const resolved = (r.stdout || '').split('\n').map(s => s.trim()).filter(Boolean)[0];
    if (!resolved) throw new Error('MCP executable not found on PATH: ' + name);
    let st;
    try {
      st = fs.statSync(resolved);
    } catch {
      throw new Error('MCP executable not accessible');
    }
    if (!st.isFile()) throw new Error('MCP executable not a file');
    try {
      fs.accessSync(resolved, fs.constants.X_OK);
    } catch {
      throw new Error('MCP executable not executable');
    }
    const low = resolved.toLowerCase();
    const tmp = (require('os').tmpdir() || '').toLowerCase();
    if ((tmp && (low === tmp || low.startsWith(tmp + path.sep))) || low.includes('/dev/shm/')) {
      throw new Error('MCP executable in temp dir not allowed');
    }
    return resolved;
  }

  mcpStartServer(id, command, args, env) {
    try {
      const bin = this._resolveMcpBin(command);
      if (!Array.isArray(args)) args = [];
      if (args.length > 50) return { ok: false, error: 'Too many MCP args' };
      const cleanArgs = args.map(String);
      for (const a of cleanArgs) {
        if (a.length > 1000 || /[\0\n\r]/.test(a)) return { ok: false, error: 'Invalid MCP argument' };
      }
      const safeEnv = {};
      if (env && typeof env === 'object') {
        for (const [k, v] of Object.entries(env)) {
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && typeof v === 'string' && v.length <= 5000) {
            safeEnv[k] = v;
          }
        }
      }
      const proc = spawn(bin, cleanArgs, { // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process — bin is allowlisted (F5), args validated, shell:false
        env: { ...process.env, ...safeEnv },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
      this._mcpServerProcesses.set(id, proc);
      proc.stdout.on('data', () => {});
      proc.stderr.on('data', () => {});
      proc.on('exit', () => this._mcpServerProcesses.delete(id));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  mcpStopServer(id) {
    const proc = this._mcpServerProcesses.get(id);
    if (proc) {
      proc.kill();
      this._mcpServerProcesses.delete(id);
      return { ok: true };
    }
    return { ok: false };
  }

  // ============= TERMINAL =============
  setPermissionGate(gate) { this._permissionGate = gate || null; }

  // Security (b-10): pinned shell binaries (no $SHELL override), cwd must be
  // inside a project root or the sandbox dir, creation goes through the gate.
  _resolveShellBin() {
    if (process.platform === 'win32') return 'powershell.exe';
    for (const cand of ['/bin/bash', '/bin/sh']) {
      try {
        fs.accessSync(cand, fs.constants.X_OK);
        const st = fs.statSync(cand);
        if (st.isFile()) return cand;
      } catch {}
    }
    throw new Error('No usable shell found');
  }

  _assertTerminalCwd(projectPath) {
    if (typeof projectPath !== 'string' || !projectPath) {
      throw new Error('Terminal requires a project path');
    }
    const { getProjectsDir, getSandboxDir, getProjectRoot, isSafeProjectName } = require('./shared');
    // Callers pass either a filesystem path or a project name — resolve names.
    let candidate = projectPath;
    if (isSafeProjectName(projectPath)) {
      const root = getProjectRoot(projectPath);
      if (root) candidate = root;
    }
    const canon = path.resolve(candidate);
    const roots = [path.resolve(getProjectsDir()), path.resolve(getSandboxDir())];
    // Also allow resolved local-project roots (user-picked folders).
    try {
      const names = fs.readdirSync(getProjectsDir(), { withFileTypes: true })
        .filter(d => d.isDirectory()).map(d => d.name).filter(isSafeProjectName).slice(0, 200);
      for (const n of names) {
        const r = getProjectRoot(n);
        if (r) roots.push(path.resolve(r));
      }
    } catch {}
    const ok = roots.some(rt => canon === rt || canon.startsWith(rt + path.sep));
    if (!ok) throw new Error('Terminal cwd outside allowed roots');
    let st;
    try {
      st = fs.statSync(canon);
    } catch {
      throw new Error('Terminal cwd does not exist');
    }
    if (!st.isDirectory()) throw new Error('Terminal cwd not a directory');
    return canon;
  }

  async terminalCreate({ projectPath, project } = {}, sender) {
    if (!ptySpawn) return null;
    const cwd = this._assertTerminalCwd(projectPath);
    const shellBin = this._resolveShellBin();
    const run = () => {
      const id = ++this._terminalIdCounter;
      const pty = ptySpawn(shellBin, [], {
        name: 'xterm-color', cols: 80, rows: 24,
        cwd,
        env: process.env
      });
      pty.onData(data => {
        if (sender && !sender.isDestroyed()) {
          sender.send('terminal:data', { id, data });
        }
      });
      pty.onExit(() => {
        delete this._terminalProcesses[id];
        if (sender && !sender.isDestroyed()) {
          sender.send('terminal:exit', { id });
        }
      });
      this._terminalProcesses[id] = pty;
      return id;
    };
    if (this._permissionGate) {
      return this._permissionGate.checkAndRun({
        project: project || null,
        backend: 'host-terminal',
        op: 'terminal',
        command: 'open interactive shell in ' + cwd,
        path: cwd,
        run,
      });
    }
    return run();
  }

  terminalResize({ id, cols, rows }) {
    if (this._terminalProcesses[id]) this._terminalProcesses[id].resize(cols, rows);
  }

  terminalWrite({ id, data }) {
    if (this._terminalProcesses[id]) this._terminalProcesses[id].write(data);
  }

  terminalKill({ id }) {
    if (this._terminalProcesses[id]) {
      this._terminalProcesses[id].kill();
      delete this._terminalProcesses[id];
    }
  }
}

module.exports = { ShellService };