const fs = require('fs');
const path = require('path');
const net = require('electron').net;
const { SandboxManager } = require('../../sandbox/manager');
const { getTemplate, listTemplates } = require('../../sandbox/os-templates');
const { VncStreamer } = require('../../sandbox/vnc-stream');
const shared = require('./shared');
const { getSettingsPath, getSandboxDir, getSandboxImagesDir, resolveSafe } = shared;

class SandboxService {
  constructor(options = {}) {
    this._send = options.send || (() => {});
    this._showSaveDialog = options.showSaveDialog || null;
    this._permissionGate = null;
    this._permissionStore = null;
    this._manager = new SandboxManager(options.sandboxDir || getSandboxDir());
    this._vncStream = null;
    this._activeProject = null;
  }

  setProject(project) {
    this._activeProject = project;
    this._manager.setProject(project);
  }

  getCustomTools(project) {
    try {
      const s = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8')).sandbox || {};
      return (s.customTools || {})[project] || [];
    } catch { return []; }
  }

  setCustomTools(project, tools) {
    // Security (b-05 adjacent): custom tools become container entrypoint
    // scripts — validate shape server-side so IPC cannot inject garbage.
    const { isSafeProjectName } = shared;
    if (!isSafeProjectName(project)) return { ok: false, error: 'invalid project' };
    if (!Array.isArray(tools) || tools.length > 50) return { ok: false, error: 'invalid tools' };
    const clean = [];
    for (const t of tools) {
      if (!t || typeof t !== 'object') return { ok: false, error: 'invalid tool' };
      if (!['apt', 'deb', 'appimage'].includes(t.type)) return { ok: false, error: 'invalid tool type' };
      if (typeof t.name !== 'string' || !/^[A-Za-z0-9._~:,/-]{1,200}$/.test(t.name)) {
        return { ok: false, error: 'invalid tool name' };
      }
      if (/[;&|`$<>!(){}\n\\]/.test(t.name)) return { ok: false, error: 'invalid tool name' };
      clean.push({ type: t.type, name: t.name, global: t.global === true });
    }
    try {
      const settings = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8'));
      const sandbox = settings.sandbox || {};
      sandbox.customTools = sandbox.customTools || {};
      sandbox.customTools[project] = clean;
      settings.sandbox = sandbox;
      fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  getSandboxDir() {
    return getSandboxDir();
  }

  async restore() {
    if (!this._manager) return;
    let saved;
    try {
      saved = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8')).sandbox || {};
    } catch { return; }
    const type = saved.type;
    if (!type || type === 'none') return;
    const result = await this._manager.trySwitchBackend(type);
    if (result.ok && saved.network) {
      try { await this._manager.setNetwork(saved.network); } catch {}
    }
    if (!result.ok) {
      console.warn('[sandbox] Aktivierung von "' + type + '" fehlgeschlagen, starte mit "none": ' + result.error);
    }
  }

  listSandboxFiles(sandboxPath) {
    const allowed = getSandboxDir();
    if (!sandboxPath || path.resolve(sandboxPath) !== path.resolve(allowed) || !fs.existsSync(sandboxPath)) return [];
    const files = [];
    function walk(d, prefix) {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        if (e.isDirectory()) walk(path.join(d, e.name), prefix + e.name + '/');
        else files.push(prefix + e.name);
      }
    }
    walk(sandboxPath, '');
    return files;
  }

  readSandboxFile(sandboxPath, filePath) {
    const allowed = getSandboxDir();
    if (!sandboxPath || path.resolve(sandboxPath) !== path.resolve(allowed)) return null;
    const full = resolveSafe(sandboxPath, filePath);
    if (!full || !fs.existsSync(full)) return null;
    return fs.readFileSync(full, 'utf-8');
  }

  writeSandboxFile(sandboxPath, filePath, content) {
    const allowed = getSandboxDir();
    if (!sandboxPath || path.resolve(sandboxPath) !== path.resolve(allowed)) return false;
    const full = resolveSafe(sandboxPath, filePath);
    if (!full) return false;
    const dir = path.dirname(full);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
    return true;
  }

  deleteSandboxFile(sandboxPath, filePath) {
    const allowed = getSandboxDir();
    if (!sandboxPath || path.resolve(sandboxPath) !== path.resolve(allowed)) return false;
    const full = resolveSafe(sandboxPath, filePath);
    if (!full) return false;
    if (fs.existsSync(full)) { fs.rmSync(full, { recursive: true }); return true; }
    return false;
  }

  setPermissionGate(gate, store) {
    this._permissionGate = gate;
    this._permissionStore = store;
  }

  _setGateForTest(gate) { this._permissionGate = gate; }

  getPermissionGate() { return this._permissionGate; }

  // Legacy string-command entry point. Routes through the active backend
  // (container/VM jails support shell syntax there) AND the permission gate —
  // never executes on the host via string-interpolated execSync.
  async execSandboxCommand(sandboxPath, command) {
    const allowed = getSandboxDir();
    if (!sandboxPath || path.resolve(sandboxPath) !== path.resolve(allowed)) {
      return { ok: false, output: 'Access denied: invalid sandbox path', code: -1 };
    }
    if (typeof command !== 'string' || command.length === 0 || command.length > 2000) {
      return { ok: false, output: 'Rejected: invalid command', code: -1 };
    }
    try {
      const result = await this.exec(command, { project: this._activeProject });
      if (result && typeof result === 'object' && 'output' in result) return result;
      return { ok: true, output: String(result == null ? '' : result), code: 0 };
    } catch (e) {
      return { ok: false, output: e.message, code: e.status || -1 };
    }
  }

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

  _gateFor(op, filePath, project) {
    if (!this._permissionGate) return null;
    return {
      project: project || this._activeProject || null,
      backend: this._manager.activeType,
      op,
      // Regex rules match against the path for file operations.
      command: filePath || '',
      path: filePath || null,
    };
  }

  async _gatedFileOp(op, filePath, run, project) {
    const spec = this._gateFor(op, filePath, project);
    if (!spec) return run();
    return this._permissionGate.checkAndRun({ ...spec, run });
  }

  async readFile(filePath, project) {
    return this._gatedFileOp('read_file', filePath, () => this._manager.readFile(filePath), project);
  }

  async writeFile(filePath, content, project) {
    return this._gatedFileOp('write_file', filePath, () => this._manager.writeFile(filePath, content), project);
  }

  async listFiles(dirPath, project) {
    return this._gatedFileOp('list_files', dirPath, () => this._manager.listFiles(dirPath), project);
  }

  async deleteFile(filePath, project) {
    return this._gatedFileOp('delete_file', filePath, () => this._manager.deleteFile(filePath), project);
  }

  async switchBackend(type) {
    const allowed = new Set(['none', 'firejail', 'docker', 'podman', 'vmware', 'qemu']);
    if (!allowed.has(type)) return { ok: false, error: 'unknown backend: ' + type };
    // Security (b-09): switching to weak isolation (none/firejail) requires
    // explicit approval — the blacklist filter is not a security boundary.
    if ((type === 'none' || type === 'firejail') && this._permissionGate) {
      try {
        await this._permissionGate.checkAndRun({
          project: this._activeProject || null,
          backend: this._manager.activeType,
          op: 'switch_backend',
          command: type,
          path: null,
          run: async () => true,
        });
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }
    const r = await this._manager.trySwitchBackend(type);
    if (this._activeProject && (type === 'docker' || type === 'podman')) {
      const t = this.getCustomTools(this._activeProject);
      this._manager.setCustomTools(type, t);
    }
    return r;
  }

  async detect() {
    return this._manager.detect();
  }

  async recommend(spec) {
    return this._manager.recommend(spec);
  }

  status() {
    return { active: this._manager.activeType, backends: this._manager.backends };
  }

  async screenshot() {
    return this._manager.screenshot();
  }

  async createSnapshot(name) {
    return this._manager.createSnapshot(name);
  }

  async sendMouse(x, y, button) {
    return this._manager.sendMouse(x, y, button);
  }

  async sendKey(key) {
    return this._manager.sendKey(key);
  }

  getConfig() {
    try { return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8')).sandbox || {}; } catch { return {}; }
  }

  setConfig(cfg) {
    try {
      const settings = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8'));
      settings.sandbox = { ...(settings.sandbox || {}), ...cfg };
      fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
      return settings.sandbox;
    } catch (e) { return { error: e.message }; }
  }

  async setNetwork(network) {
    await this._manager.setNetwork(network);
    return { ok: true, network };
  }

  listTemplates() {
    return listTemplates();
  }

  async downloadImage(templateKey) {
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
          this._send('sandbox:download-progress', { key: templateKey, received, total, pct: total ? Math.round(received / total * 100) : 0 });
        });
        res.on('end', () => { ws.end(); resolve(); });
        res.on('error', reject);
      });
      return { ok: true, path: dest };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  async vmStreamStart(opts) {
    try {
      this._vncStream = new VncStreamer(opts || { port: 5900 });
      this._vncStream.onFrame((frame) => {
        this._send('sandbox:vm-frame', {
          width: frame.width, height: frame.height, buffer: frame.buffer,
          jpeg: frame.buffer ? frame.buffer.toString('base64') : null,
        });
      });
      await this._vncStream.start();
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  vmStreamStop() {
    if (this._vncStream) this._vncStream.stop();
    this._vncStream = null;
    return { ok: true };
  }

  async downloadFile(sourcePath) {
    if (!this._showSaveDialog) return { ok: false, error: 'Dialog not available' };
    const sandbox = getSandboxDir();
    const full = resolveSafe(sandbox, sourcePath);
    if (!full || !fs.existsSync(full)) return { ok: false, error: 'File not found' };
    const result = await this._showSaveDialog({
      defaultPath: path.basename(sourcePath),
      filters: [{ name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, error: 'Cancelled' };
    try {
      fs.copyFileSync(full, result.filePath);
      return { ok: true, path: result.filePath };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Security (b-05): permission rules via IPC are strictly project-scoped.
  // global:true is rejected — otherwise any renderer/plugin could disable the
  // gate for all projects. tool_type/action/path are allowlisted.
  static _RULE_TOOL_RE = /^[a-z][a-z0-9_-]{0,40}$/;
  static _RULE_CATEGORIES = new Set([
    'exec', 'file-read', 'file-write', 'file-delete', 'file-list',
    'vm-snapshot', 'vm-input', 'browser', 'git', 'terminal', 'mcp',
  ]);

  _validateRule(rule) {
    if (!rule || typeof rule !== 'object') return 'invalid rule';
    if (rule.global) return 'global rules not allowed via IPC';
    const { isSafeProjectName } = shared;
    if (!isSafeProjectName(rule.project)) return 'invalid project';
    if (typeof rule.tool_type !== 'string' || !SandboxService._RULE_TOOL_RE.test(rule.tool_type)) {
      return 'invalid tool_type';
    }
    if (!['allow', 'ask', 'block'].includes(rule.action)) return 'invalid action';
    if (rule.path !== undefined && (typeof rule.path !== 'string' || rule.path.length > 300)) {
      return 'invalid path';
    }
    return null;
  }

  addPermissionRule(rule) {
    if (!this._permissionStore) return { ok: false, error: 'permission store not initialized' };
    const err = this._validateRule(rule);
    if (err) return { ok: false, error: err };
    const r = this._permissionStore.set(rule.project, rule.tool_type, rule.action, { path: rule.path || '', global: false });
    return { ok: true, rule: r };
  }

  removePermissionRule(rule) {
    if (!this._permissionStore) return { ok: false, error: 'permission store not initialized' };
    if (!rule || typeof rule !== 'object') return { ok: false };
    if (rule.global) return { ok: false, error: 'global rules not allowed via IPC' };
    const { isSafeProjectName } = shared;
    if (!isSafeProjectName(rule.project)) return { ok: false };
    if (typeof rule.tool_type !== 'string' || !SandboxService._RULE_TOOL_RE.test(rule.tool_type)) {
      return { ok: false };
    }
    const done = this._permissionStore.remove(rule.project, rule.tool_type, { path: rule.path || '', global: false });
    return { ok: done };
  }

  getPermissionRules(project) {
    if (!this._permissionStore) return [];
    return this._permissionStore.getAllEffective(project);
  }
}

module.exports = { SandboxService };