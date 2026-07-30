const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { SandboxBackend } = require('../backend');

const UNSAFE_PATTERN = /[;&|`$\n]/;

class NoneBackend extends SandboxBackend {
  get type() { return 'none'; }
  get label() { return 'Keine Sandbox (aktuell)'; }
  get description() { return 'Direkte Ausführung ohne Isolation. Dateisystem-Pfad-Prüfung und unsichere Zeichen werden blockiert.'; }

  constructor(sandboxDir) {
    super();
    this._sandboxDir = sandboxDir;
  }

  async isAvailable() { return true; }

  async exec(command, options = {}) {
    const cwd = options.cwd || this._sandboxDir;
    const resolved = path.resolve(cwd);
    const allowed = path.resolve(this._sandboxDir);

    if (resolved !== allowed && !resolved.startsWith(allowed + path.sep)) {
      return { ok: false, output: 'Access denied: invalid path', code: -1 };
    }
    if (UNSAFE_PATTERN.test(command)) {
      return { ok: false, output: 'Rejected: unsafe characters', code: -1 };
    }

    try {
      const output = execSync(command, {
        cwd: allowed,
        timeout: options.timeout || 30000,
        encoding: 'utf-8'
      });
      return { ok: true, output, code: 0 };
    } catch (e) {
      return { ok: false, output: e.stderr || e.message, code: e.status || -1 };
    }
  }

  async readFile(filePath) {
    const allowed = path.resolve(this._sandboxDir);
    const resolved = path.resolve(this._sandboxDir, filePath);
    if (resolved !== allowed && !resolved.startsWith(allowed + path.sep)) throw new Error('Access denied');
    return fs.readFileSync(resolved, 'utf-8');
  }

  async writeFile(filePath, content) {
    const allowed = path.resolve(this._sandboxDir);
    const resolved = path.resolve(this._sandboxDir, filePath);
    if (resolved !== allowed && !resolved.startsWith(allowed + path.sep)) throw new Error('Access denied');
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, 'utf-8');
  }

  async listFiles(dirPath) {
    const allowed = path.resolve(this._sandboxDir);
    const resolved = path.resolve(this._sandboxDir, dirPath || '');
    if (resolved !== allowed && !resolved.startsWith(allowed + path.sep)) throw new Error('Access denied');
    return fs.readdirSync(resolved);
  }

  async deleteFile(filePath) {
    const allowed = path.resolve(this._sandboxDir);
    const resolved = path.resolve(this._sandboxDir, filePath);
    if (resolved !== allowed && !resolved.startsWith(allowed + path.sep)) throw new Error('Access denied');
    fs.unlinkSync(resolved);
  }
}

module.exports = { NoneBackend };
