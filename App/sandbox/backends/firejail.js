const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { SandboxBackend } = require('../backend');

const UNSAFE_PATTERN = /[;&|`$\n]/;

class FirejailBackend extends SandboxBackend {
  get type() { return 'firejail'; }
  get label() { return 'Firejail Sandbox'; }
  get description() { return 'Leichtgewichtige Linux-Sandbox. Befehle laufen in eingeschränkter Umgebung mit read-only FS, keinem Netzwerk (optional) und gedroppten Capabilities.'; }

  constructor(workspaceDir) {
    super();
    this._workspaceDir = workspaceDir;
    this._profilePath = path.join(os.homedir(), '.config', 'florde', 'firejail.profile');
    this._containerName = 'florde-sandbox';
  }

  async isAvailable() {
    try {
      execSync('which firejail', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  async init() {
    const profile = `# florde firejail profile
read-only /
private-dev
private-tmp
caps.drop all
seccomp
noroot
whitelist ${this._workspaceDir}
netfilter
${this._networkRule()}
`;
    fs.mkdirSync(path.dirname(this._profilePath), { recursive: true });
    fs.writeFileSync(this._profilePath, profile);
    this._initialized = true;
  }

  _networkRule(network) {
    switch (network) {
      case 'none': return 'net none';
      case 'localhost': return 'net lo';
      case 'project': return 'net lo';
      default: return '';
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
      const firejailCmd = `firejail --profile=${profile} --private-cwd=${cwd} bash -c ${JSON.stringify(command)}`;
      const output = execSync(firejailCmd, {
        timeout: options.timeout || 30000,
        encoding: 'utf-8'
      });
      return { ok: true, output, code: 0 };
    } catch (e) {
      return { ok: false, output: e.stderr || e.message, code: e.status || -1 };
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
