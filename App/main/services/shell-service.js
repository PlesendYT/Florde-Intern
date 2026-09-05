const fs = require('fs');
const path = require('path');
const { net, safeStorage } = require('electron');
const { spawn, spawnSync, execSync } = require('child_process');

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
  gitStatus(repoPath) {
    try {
      const out = execSync('git status --porcelain', { cwd: repoPath, timeout: 10000, encoding: 'utf-8' });
      return out.trim();
    } catch { return ''; }
  }

  gitDiff(repoPath) {
    try {
      const out = execSync('git diff', { cwd: repoPath, timeout: 10000, encoding: 'utf-8' });
      return out;
    } catch { return ''; }
  }

  gitCommit(repoPath, name, description) {
    try {
      const out = execSync(`git commit -m "${name.replace(/"/g, '\\"')}" -m "${description.replace(/"/g, '\\"')}"`, { cwd: repoPath, timeout: 10000, encoding: 'utf-8' });
      return { ok: true, output: out };
    } catch (e) { return { ok: false, error: e.stderr || e.message }; }
  }

  gitBranchList(repoPath) {
    try {
      const out = execSync('git branch -a', { cwd: repoPath, timeout: 10000, encoding: 'utf-8' });
      return out.trim().split('\n').map(l => l.trim()).filter(Boolean);
    } catch { return []; }
  }

  gitBranchCreate(repoPath, name) {
    try {
      execSync(`git branch ${name}`, { cwd: repoPath, timeout: 10000, encoding: 'utf-8' });
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  gitBranchDelete(repoPath, name) {
    try {
      execSync(`git branch -d ${name}`, { cwd: repoPath, timeout: 10000, encoding: 'utf-8' });
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  gitCheckout(repoPath, name) {
    try {
      execSync(`git checkout ${name}`, { cwd: repoPath, timeout: 10000, encoding: 'utf-8' });
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  gitExec(repoPath, args) {
    try {
      const out = execSync(`git ${args.join(' ')}`, { cwd: repoPath, timeout: 10000, encoding: 'utf-8' });
      return { ok: true, output: out };
    } catch (e) { return { ok: false, error: e.stderr || e.message }; }
  }

  gitLog(repoPath, limit = 50) {
    try {
      const out = execSync(`git log --oneline -n ${limit}`, { cwd: repoPath, timeout: 10000, encoding: 'utf-8' });
      return out.trim().split('\n').filter(Boolean);
    } catch { return []; }
  }

  gitBlame(repoPath, filePath) {
    try {
      const out = execSync(`git blame ${filePath}`, { cwd: repoPath, timeout: 10000, encoding: 'utf-8' });
      return out;
    } catch { return ''; }
  }

  gitDiffFile(repoPath, filePath) {
    try {
      const out = execSync(`git diff ${filePath}`, { cwd: repoPath, timeout: 10000, encoding: 'utf-8' });
      return out;
    } catch { return ''; }
  }

  gitPush(repoPath, remote = 'origin', branch) {
    try {
      const b = branch || execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath, timeout: 10000, encoding: 'utf-8' }).trim();
      const r = spawnSync('git', ['push', remote, b], { cwd: repoPath, timeout: 30000, encoding: 'utf-8', shell: false });
      if (r.error) throw r.error;
      if (r.status !== 0) return { ok: false, error: r.stderr || r.stdout };
      return { ok: true };
    } catch (e) { return { ok: false, error: e.stderr || e.message }; }
  }

  gitPull(repoPath, remote = 'origin', branch) {
    try {
      const b = branch || execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath, timeout: 10000, encoding: 'utf-8' }).trim();
      const r = spawnSync('git', ['pull', remote, b], { cwd: repoPath, timeout: 30000, encoding: 'utf-8', shell: false });
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
  mcpStartServer(id, command, args, env) {
    try {
      const proc = spawn(command, args, {
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32'
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
  terminalCreate({ projectPath }, sender) {
    if (!ptySpawn) return null;
    const id = ++this._terminalIdCounter;
    const shellBin = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
    const pty = ptySpawn(shellBin, [], {
      name: 'xterm-color', cols: 80, rows: 24,
      cwd: projectPath || process.cwd(),
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