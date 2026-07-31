const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { SandboxBackend } = require('../backend');
const { getTemplate } = require('../os-templates');

class VMWareBackend extends SandboxBackend {
  get type() { return 'vmware'; }
  get label() { return 'VMware Sandbox'; }
  get description() { return 'Vollständige VM-Isolation via VMware Workstation. Bietet Screen-Capture, Maus-/Tastatursteuerung und Snapshots für risikoreiche Aufgaben.'; }

  constructor(workspaceDir, options = {}) {
    super();
    this._workspaceDir = workspaceDir;
    this._template = options.template || 'ubuntu';
    this._vmxPath = null;
    this._vmName = null;
    this._guestUser = null;
    this._guestPass = null;
    this._vncPort = null;
  }

  _run(args, timeout = 30000) {
    try {
      const r = spawnSync('vmrun', ['-T', 'ws', ...args], { timeout, encoding: 'utf-8', stdio: 'pipe' });
      const ok = r.status === 0 && !r.error && !r.signal;
      return { ok, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim(), code: r.status ?? -1 };
    } catch (e) {
      return { ok: false, stdout: '', stderr: e.message, code: -1 };
    }
  }

  async isAvailable() {
    const r = this._run(['list']);
    return r.ok;
  }

  async init() {
    if (this._initialized) return;
    this._initialized = true;
  }

  async exec(command, options = {}) {
    if (!this._initialized) await this.init();
    if (!this._guestUser || !this._guestPass) {
      return { ok: false, output: 'VM not started or credentials not set', code: -1 };
    }
    const timeout = options.timeout || 30000;
    const r = this._run([
      '-gu', this._guestUser, '-gp', this._guestPass,
      'runProgramInGuest', this._vmxPath,
      '-interactive', '-activeWindow',
      'sh', '-c', command,
    ], timeout);
    return { ok: r.ok, output: r.stdout || r.stderr, code: r.code };
  }

  async startVM() {
    if (!this._initialized) throw new Error('VM not initialized');
    const r = this._run(['start', this._vmxPath, 'nogui']);
    if (!r.ok) throw new Error('Failed to start VM: ' + r.stderr);
  }

  async stopVM() {
    if (!this._initialized) throw new Error('VM not initialized');
    const r = this._run(['stop', this._vmxPath]);
    if (!r.ok) throw new Error('Failed to stop VM: ' + r.stderr);
  }

  async screenshot() {
    if (!this._initialized) throw new Error('VM not initialized');
    const screenshotPath = path.join(os.tmpdir(), `vmware-screen-${Date.now()}.png`);
    const r = this._run(['captureScreen', this._vmxPath, screenshotPath]);
    if (!r.ok) throw new Error('Failed to capture screen: ' + r.stderr);
    const buffer = fs.readFileSync(screenshotPath);
    fs.rmSync(screenshotPath);
    return buffer.toString('base64');
  }

  async sendMouse(x, y, button = 'left') {
    if (!this._initialized) throw new Error('VM not initialized');
    throw new Error('sendMouse requires VNC connection — see VNC task');
  }

  async sendKey(key) {
    if (!this._initialized) throw new Error('VM not initialized');
    throw new Error('sendKey requires VNC connection — see VNC task');
  }

  async createSnapshot(name) {
    if (!this._initialized) throw new Error('VM not initialized');
    const r = this._run(['snapshot', this._vmxPath, name]);
    if (!r.ok) throw new Error('Failed to create snapshot: ' + r.stderr);
  }

  async revertSnapshot(name) {
    if (!this._initialized) throw new Error('VM not initialized');
    const r = this._run(['revertToSnapshot', this._vmxPath, name]);
    if (!r.ok) throw new Error('Failed to revert snapshot: ' + r.stderr);
  }

  async readFile(filePath) {
    if (!this._initialized) await this.init();
    const hostPath = path.join(os.tmpdir(), `vmware-file-${Date.now()}`);
    const r = this._run(['copyFileFromGuestToHost', this._vmxPath, filePath, hostPath]);
    if (!r.ok) throw new Error('Failed to read file: ' + r.stderr);
    const content = fs.readFileSync(hostPath, 'utf-8');
    fs.rmSync(hostPath);
    return content;
  }

  async writeFile(filePath, content) {
    if (!this._initialized) await this.init();
    const hostPath = path.join(os.tmpdir(), `vmware-file-${Date.now()}`);
    fs.writeFileSync(hostPath, content, 'utf-8');
    const r = this._run(['copyFileFromHostToGuest', this._vmxPath, hostPath, filePath]);
    fs.rmSync(hostPath);
    if (!r.ok) throw new Error('Failed to write file: ' + r.stderr);
  }

  async listFiles(dirPath) {
    if (!this._initialized) await this.init();
    const r = await this.exec(`ls -1 ${dirPath}`);
    if (!r.ok) throw new Error('Failed to list files');
    return r.output.split('\n').filter(Boolean);
  }

  async deleteFile(filePath) {
    if (!this._initialized) await this.init();
    const r = this._run(['deleteFileInGuest', this._vmxPath, filePath]);
    if (!r.ok) throw new Error('Failed to delete file: ' + r.stderr);
  }

  async destroy() {
    if (this._initialized) {
      await this.stopVM();
    }
    this._initialized = false;
  }
}

module.exports = { VMWareBackend };
