const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { SandboxBackend } = require('../backend');

const UNSAFE_PATTERN = /[;&|`$<>!~{}()\n\\]/;

class FirejailBackend extends SandboxBackend {
  get type() { return 'firejail'; }
  get label() { return 'Firejail Sandbox'; }
  get description() { return 'Leichtgewichtige Linux-Sandbox. Befehle laufen in eingeschränkter Umgebung mit read-only FS, keinem Netzwerk (optional) und gedroppten Capabilities.'; }

  constructor(workspaceDir) {
    super();
    this._workspaceDir = workspaceDir;
    this._profilePath = path.join(os.homedir(), '.config', 'florde', 'firejail.profile');
    this._network = 'none';
  }

  async isAvailable() {
    try {
      execSync('which firejail', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  // Security (b-30): setNetwork previously did nothing (profile hardcoded
  // 'none' at init). Now it persists the mode and regenerates the profile.
  static _NETWORK_MODES = new Set(['none', 'localhost', 'lo', 'project', 'projects', 'all', 'eth0']);

  setNetwork(network) {
    const mode = String(network || 'none').toLowerCase();
    if (!FirejailBackend._NETWORK_MODES.has(mode)) throw new Error('Unknown network mode: ' + network);
    this._network = mode;
    if (this._initialized) this._writeProfile();
    return this._network;
  }

  _writeProfile() {
    const profile = `# florde firejail profile
read-only /
private-dev
private-tmp
caps.drop all
seccomp
noroot
whitelist ${this._workspaceDir}
netfilter
${this._networkRule(this._network)}
`;
    fs.mkdirSync(path.dirname(this._profilePath), { recursive: true });
    fs.writeFileSync(this._profilePath, profile);
  }

  async init() {
    this._writeProfile();
    this._initialized = true;
  }

  _networkRule(network) {
    // Fail-closed: unknown modes get 'net none', never full network.
    switch (network) {
      case 'none': return 'net none';
      case 'localhost':
      case 'lo':
      case 'project':
      case 'projects': return 'net lo';
      case 'all':
      case 'eth0': return 'net eth0';
      default: return 'net none';
    }
  }

  async exec(command, options = {}) {
    if (!this._initialized) await this.init();
    const cwd = options.cwd || this._workspaceDir;

    if (UNSAFE_PATTERN.test(command)) {
      return { ok: false, output: 'Rejected: unsafe characters', code: -1 };
    }

    try {
      const network = options.network || 'none';
      const profile = this._profilePath;
      const result = spawnSync('firejail', ['--profile', profile, '--private-cwd', cwd, 'bash', '-c', command], {
        timeout: options.timeout || 30000,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      return { ok: result.status === 0, output: result.stdout || result.stderr, code: result.status ?? -1 };
    } catch (e) {
      return { ok: false, output: e.message, code: -1 };
    }
  }

  async readFile(filePath) {
    const allowed = path.resolve(this._workspaceDir);
    const resolved = path.resolve(this._workspaceDir, filePath);
    if (resolved !== allowed && !resolved.startsWith(allowed + path.sep)) throw new Error('Access denied');
    return fs.readFileSync(resolved, 'utf-8');
  }

  async writeFile(filePath, content) {
    const allowed = path.resolve(this._workspaceDir);
    const resolved = path.resolve(this._workspaceDir, filePath);
    if (resolved !== allowed && !resolved.startsWith(allowed + path.sep)) throw new Error('Access denied');
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, 'utf-8');
  }

  async listFiles(dirPath) {
    const allowed = path.resolve(this._workspaceDir);
    const resolved = path.resolve(this._workspaceDir, dirPath || '');
    if (resolved !== allowed && !resolved.startsWith(allowed + path.sep)) throw new Error('Access denied');
    return fs.readdirSync(resolved);
  }

  async deleteFile(filePath) {
    const allowed = path.resolve(this._workspaceDir);
    const resolved = path.resolve(this._workspaceDir, filePath);
    if (resolved !== allowed && !resolved.startsWith(allowed + path.sep)) throw new Error('Access denied');
    fs.unlinkSync(resolved);
  }

  async destroy() {
    this._initialized = false;
  }
}

module.exports = { FirejailBackend };
