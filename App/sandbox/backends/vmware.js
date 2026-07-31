const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { SandboxBackend } = require('../backend');
const { getTemplate } = require('../os-templates');
const { VNCClient } = require('../vnc-client');

const KEY_MAP = {
  enter: 0xff0d, backspace: 0xff08, tab: 0xff09,
  escape: 0xff1b, space: 0x0020,
  up: 0xff52, down: 0xff54, left: 0xff51, right: 0xff53,
  f1: 0xffbe, f2: 0xffbf, f3: 0xffc0, f4: 0xffc1,
  f5: 0xffc2, f6: 0xffc3, f7: 0xffc4, f8: 0xffc5,
  f9: 0xffc6, f10: 0xffc7, f11: 0xffc8, f12: 0xffc9,
  home: 0xff50, end: 0xff57, pageup: 0xff55, pagedown: 0xff56,
  insert: 0xff63, delete: 0xffff,
  control: 0xffe3, ctrl: 0xffe3, alt: 0xffe9, shift: 0xffe1,
};

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
    if (!this._vncPort) throw new Error('VNC not configured for this VM');
    const vnc = new VNCClient({ port: this._vncPort });
    try {
      await vnc.connect();
      const btnMap = { left: 1, middle: 2, right: 3 };
      vnc.sendMouse(x, y, btnMap[button] || 0);
    } finally {
      vnc.disconnect();
    }
  }

  async sendKey(key) {
    if (!this._initialized) throw new Error('VM not initialized');
    if (!this._vncPort) throw new Error('VNC not configured for this VM');
    const vnc = new VNCClient({ port: this._vncPort });
    try {
      await vnc.connect();
      const keysym = KEY_MAP[key.toLowerCase()] || key.charCodeAt(0);
      vnc.sendKey(keysym);
    } finally {
      vnc.disconnect();
    }
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
