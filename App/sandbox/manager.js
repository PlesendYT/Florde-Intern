const crypto = require('crypto');
const { NoneBackend } = require('./backends/none');
const { FirejailBackend } = require('./backends/firejail');
const { DockerBackend } = require('./backends/docker');
const { PodmanBackend } = require('./backends/podman');
const { VMWareBackend } = require('./backends/vmware');
const { QEMUBackend } = require('./backends/qemu');
const { SystemDetector } = require('./system-detector');

function projectHash(project) {
  return (project ? crypto.createHash('sha256').update(String(project)).digest('hex').substring(0, 12) : 'default');
}

class SandboxManager {
  constructor(workspaceDir, options = {}) {
    this._workspaceDir = workspaceDir;
    this._project = options.project || null;
    this._backends = new Map();
    this._activeType = 'none';
    this._listeners = new Map();

    // Register backends
    this._register('none', new NoneBackend(workspaceDir));
    this._register('firejail', new FirejailBackend(workspaceDir));
    this._register('docker', new DockerBackend(workspaceDir, { project: this._project }));
    this._register('podman', new PodmanBackend(workspaceDir, { project: this._project }));
    this._register('vmware', new VMWareBackend(workspaceDir));
    this._register('qemu', new QEMUBackend(workspaceDir));
  }

  _register(type, backend) {
    this._backends.set(type, backend);
  }

  get activeType() { return this._activeType; }
  get active() { return this._backends.get(this._activeType); }
  get backends() { return Array.from(this._backends.keys()); }

  getProject() { return this._project; }

  setProject(project) {
    this._project = project;
    const hash = projectHash(project);
    for (const type of ['docker', 'podman']) {
      const b = this._backends.get(type);
      if (b && '_project' in b) {
        b._project = project;
        b.projectHash = hash;
      }
    }
  }

  setCustomTools(type, tools) {
    if (this._backends.has(type)) {
      const b = this._backends.get(type);
      if ('_customTools' in b) b._customTools = [...(tools || [])];
    }
  }

  getCustomTools(type) {
    if (!this._backends.has(type)) return [];
    const b = this._backends.get(type);
    return ('_customTools' in b) ? [...b._customTools] : [];
  }

  _emit(event, data) {
    const handlers = this._listeners.get(event);
    if (handlers) handlers.forEach(fn => fn(data));
  }

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(fn);
  }

  off(event, fn) {
    const handlers = this._listeners.get(event);
    if (handlers) this._listeners.set(event, handlers.filter(f => f !== fn));
  }

  // Security (b-33): serialize backend switches — parallel switches could
  // run two backends (and containers) concurrently. The stored lock is
  // rejection-isolated so one failed switch does not poison later ones.
  switchBackend(type) {
    const run = (this._switchLock || Promise.resolve())
      .catch(() => {})
      .then(() => this._switchBackendInner(type));
    this._switchLock = run.catch(() => {});
    return run;
  }

  async _switchBackendInner(type) {
    if (!this._backends.has(type)) throw new Error('Unknown backend: ' + type);
    if (this._activeType === type) return;

    // Init new FIRST so an init failure leaves the current backend intact
    const next = this._backends.get(type);
    if (!next.initialized) {
      await next.init();
    }

    // Destroy current only after the new backend is ready
    const current = this.active;
    if (current && current !== next && current.initialized) {
      await current.destroy();
    }

    this._activeType = type;
    this._emit('switch', { type });
  }

  // Security (b-33): remove a deleted project's orphaned tool volumes.
  // Named per-project-hash volumes otherwise linger forever.
  async removeProjectVolumes(project) {
    if (typeof project !== 'string' || !project) return { ok: false, error: 'invalid project' };
    const vol = 'florde-sbx-' + projectHash(project) + '-tools';
    const removed = [];
    for (const type of ['docker', 'podman']) {
      const b = this._backends.get(type);
      if (!b || typeof b._run !== 'function') continue;
      try {
        const r = b._run(['volume', 'rm', '-f', vol]);
        if (r && r.ok) removed.push(type + ':' + vol);
      } catch {}
    }
    return { ok: true, removed };
  }

  async trySwitchBackend(type) {
    try {
      await this.switchBackend(type);
      return { ok: true, active: this._activeType };
    } catch (e) {
      return { ok: false, error: e.message, active: this._activeType };
    }
  }

  async exec(command, options = {}) {
    const result = await this.active.exec(command, options);
    this._emit('exec', { command, result });
    return result;
  }

  async readFile(filePath) { return this.active.readFile(filePath); }
  async writeFile(filePath, content) { return this.active.writeFile(filePath, content); }
  async listFiles(dirPath) { return this.active.listFiles(dirPath); }
  async deleteFile(filePath) { return this.active.deleteFile(filePath); }

  // VM operations (throw on non-VM backends)
  async startVM() { return this.active.startVM(); }
  async stopVM() { return this.active.stopVM(); }
  async screenshot() { return this.active.screenshot(); }
  async sendMouse(x, y, button) { return this.active.sendMouse(x, y, button); }
  async sendKey(key) { return this.active.sendKey(key); }
  async createSnapshot(name) { return this.active.createSnapshot(name); }
  async revertSnapshot(name) { return this.active.revertSnapshot(name); }

  // System detection
  async detect() { return SystemDetector.detect(); }
  async recommend(spec) { return SystemDetector.recommend(spec); }

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
}

module.exports = { SandboxManager };
