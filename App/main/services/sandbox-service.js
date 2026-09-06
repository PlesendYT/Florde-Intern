const fs = require('fs');
const path = require('path');
const net = require('electron').net;
const { execSync } = require('child_process');
const { SandboxManager } = require('../../sandbox/manager');
const { getTemplate, listTemplates } = require('../../sandbox/os-templates');
const { VncStreamer } = require('../../sandbox/vnc-stream');
const shared = require('./shared');
const { getSettingsPath, getSandboxDir, getSandboxImagesDir, resolveSafe } = shared;
const { assessCommandRisk } = require('./mainrisk');

class SandboxService {
  constructor(options = {}) {
    this._send = options.send || (() => {});
    this._showSaveDialog = options.showSaveDialog || null;
    this._permissionGate = null;
    this._permissionStore = null;
    this._manager = new SandboxManager(options.sandboxDir || getSandboxDir());
    this._vncStream = null;
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

  execSandboxCommand(sandboxPath, command) {
    const allowed = getSandboxDir();
    if (!sandboxPath || path.resolve(sandboxPath) !== path.resolve(allowed)) return { ok: false, output: 'Access denied: invalid sandbox path', code: -1 };
    if (/[;&|`$<>!~{}()\n\\]/.test(command) || command.trimStart().startsWith('-')) return { ok: false, output: 'Rejected: command contains unsafe characters', code: -1 };
    try {
      if (this._permissionGate) {
        // execSandboxCommand ist synchron (execSync); hier bewusst eine vereinfachte
        // synchrone Regel-Prüfung (kein async evaluate möglich):
        // - eine explizite 'exec'-Kategorie-Regel (pfadlos) blockt, wenn disallowed
        // - critical/high-Risiko wird blockt, solange keine explizite allow-Regel existiert
        const risk = assessCommandRisk(command);
        const category = 'exec';
        const rules = this._permissionStore ? this._permissionStore.getAllEffective(null) : [];
        const catRule = rules.find(r => r.tool_type === category && (r.path === null || r.path === '' || r.path === undefined));
        if (catRule && !catRule.allowed) return { ok: false, output: 'blocked: command not permitted', code: -1 };
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

  async readFile(filePath) {
    return this._manager.readFile(filePath);
  }

  async writeFile(filePath, content) {
    return this._manager.writeFile(filePath, content);
  }

  async listFiles(dirPath) {
    return this._manager.listFiles(dirPath);
  }

  async deleteFile(filePath) {
    return this._manager.deleteFile(filePath);
  }

  async switchBackend(type) {
    return this._manager.trySwitchBackend(type);
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
}

module.exports = { SandboxService };