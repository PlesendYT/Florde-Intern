const { NoneBackend } = require('./backends/none');
const { FirejailBackend } = require('./backends/firejail');
const { DockerBackend } = require('./backends/docker');
const { PodmanBackend } = require('./backends/podman');
const { VMWareBackend } = require('./backends/vmware');
const { QEMUBackend } = require('./backends/qemu');
const { SystemDetector } = require('./system-detector');

class SandboxManager {
  constructor(workspaceDir) {
    this._workspaceDir = workspaceDir;
    this._backends = new Map();
    this._activeType = 'none';
    this._listeners = new Map();

    // Register backends
    this._register('none', new NoneBackend(workspaceDir));
    this._register('firejail', new FirejailBackend(workspaceDir));
    this._register('docker', new DockerBackend(workspaceDir));
    this._register('podman', new PodmanBackend(workspaceDir));
    this._register('vmware', new VMWareBackend(workspaceDir));
    this._register('qemu', new QEMUBackend(workspaceDir));
  }

  _register(type, backend) {
    this._backends.set(type, backend);
  }

  get activeType() { return this._activeType; }
  get active() { return this._backends.get(this._activeType); }
  get backends() { return Array.from(this._backends.keys()); }

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

  async switchBackend(type) {
    if (!this._backends.has(type)) throw new Error('Unknown backend: ' + type);
    if (this._activeType === type) return;

    // Destroy current
    const current = this.active;
    if (current && current.initialized) {
      await current.destroy();
    }

    // Init new
    const next = this._backends.get(type);
    if (!next.initialized) {
      await next.init();
    }

    this._activeType = type;
    this._emit('switch', { type });
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
  async screenshot() { return this.active.screenshot(); }
  async sendMouse(x, y, button) { return this.active.sendMouse(x, y, button); }
  async sendKey(key) { return this.active.sendKey(key); }
  async createSnapshot(name) { return this.active.createSnapshot(name); }
  async revertSnapshot(name) { return this.active.revertSnapshot(name); }

  // System detection
  async detect() { return SystemDetector.detect(); }
  async recommend(spec) { return SystemDetector.recommend(spec); }
}

module.exports = { SandboxManager };
