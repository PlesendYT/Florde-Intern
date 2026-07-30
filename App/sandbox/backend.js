class SandboxBackend {
  constructor() {
    if (new.target === SandboxBackend) {
      throw new Error('SandboxBackend is abstract');
    }
    this._initialized = false;
  }

  // --- Meta ---
  get type() { throw new Error('abstract'); }
  get label() { throw new Error('abstract'); }
  get description() { throw new Error('abstract'); }

  // --- Detection ---
  async isAvailable() { throw new Error('abstract'); }

  // --- Lifecycle ---
  async init() { this._initialized = true; }
  async destroy() { this._initialized = false; }
  get initialized() { return this._initialized; }

  // --- Execution ---
  async exec(command, options = {}) {
    // options: { cwd, network, timeout, env }
    throw new Error('abstract');
  }

  // --- Filesystem ---
  async readFile(path) { throw new Error('abstract'); }
  async writeFile(path, content) { throw new Error('abstract'); }
  async listFiles(path) { throw new Error('abstract'); }
  async deleteFile(path) { throw new Error('abstract'); }

  // --- VM (optional — throw by default) ---
  async startVM() { throw new Error('VM operations not supported by ' + this.type); }
  async stopVM() { throw new Error('VM operations not supported by ' + this.type); }
  async screenshot() { throw new Error('VM operations not supported by ' + this.type); }
  async sendMouse(x, y, button) { throw new Error('VM operations not supported by ' + this.type); }
  async sendKey(key) { throw new Error('VM operations not supported by ' + this.type); }
  async createSnapshot(name) { throw new Error('VM operations not supported by ' + this.type); }
  async revertSnapshot(name) { throw new Error('VM operations not supported by ' + this.type); }
}

module.exports = { SandboxBackend };
