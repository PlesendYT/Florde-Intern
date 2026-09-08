const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { SandboxBackend } = require('../backend');
const { VNCClient } = require('../vnc-client');

// Security (b-08): POSIX single-quote for guest-shell interpolation.
function _shQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

class QEMUBackend extends SandboxBackend {
  get type() { return 'qemu'; }
  get label() { return 'QEMU/KVM Sandbox'; }
  get description() { return 'VM-Isolation via QEMU/KVM und libvirt. Bietet Screen-Capture, Tastatursteuerung und Snapshots.'; }

  constructor(workspaceDir, options = {}) {
    super();
    this._workspaceDir = workspaceDir;
    this._template = options.template || 'ubuntu';
    this._domainName = null;
    this._guestUser = null;
    this._guestPass = null;
    this._vncPort = null;
    this._network = options.network || 'nat';
  }

  get network() { return this._network; }
  set network(value) { this._network = value; }

  _run(args, timeout = 30000) {
    try {
      const r = spawnSync('virsh', args, { timeout, encoding: 'utf-8', stdio: 'pipe' });
      const ok = r.status === 0 && !r.error && !r.signal;
      return { ok, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim(), code: r.status ?? -1 };
    } catch (e) {
      return { ok: false, stdout: '', stderr: e.message, code: -1 };
    }
  }

  async isAvailable() {
    const r = this._run(['list', '--all']);
    return r.ok;
  }

  async init() {
    if (this._initialized) return;
    this._initialized = true;
  }

  async exec(command, options = {}) {
    if (!this._initialized) await this.init();
    const timeout = options.timeout || 60000;
    // Via QEMU Guest Agent: guest-exec
    const execResult = this._run([
      'qemu-agent-command', this._domainName,
      JSON.stringify({
        execute: 'guest-exec',
        arguments: { path: '/bin/sh', arg: ['-c', command], captureOutput: true }
      }),
    ], timeout);
    if (!execResult.ok) return { ok: false, output: execResult.stderr, code: -1 };

    // Parse PID from response
    let pid;
    try { pid = JSON.parse(execResult.stdout).return.pid; } catch { return { ok: false, output: execResult.stdout, code: -1 }; }

    // Poll for completion
    const start = Date.now();
    let statusResult;
    while (Date.now() - start < timeout) {
      statusResult = this._run([
        'qemu-agent-command', this._domainName,
        JSON.stringify({ execute: 'guest-exec-status', arguments: { pid } }),
      ]);
      if (!statusResult.ok) { break; }
      try {
        const parsed = JSON.parse(statusResult.stdout);
        if (parsed.return.exited) {
          const output = parsed.return['out-data'] || '';
          const errData = parsed.return['err-data'] || '';
          const combined = errData ? `${output}\n${errData}`.trim() : output;
          return { ok: parsed.return.exitcode === 0, output: combined, code: parsed.return.exitcode ?? -1 };
        }
      } catch { break; }
      // Wait 500ms before polling again
      await new Promise(r => setTimeout(r, 500));
    }
    return { ok: false, output: 'Command timed out', code: -1 };
  }

  async startVM() {
    if (!this._initialized) throw new Error('VM not initialized');
    const r = this._run(['start', this._domainName]);
    if (!r.ok) throw new Error('Failed to start VM: ' + r.stderr);
  }

  async stopVM() {
    if (!this._initialized) throw new Error('VM not initialized');
    const r = this._run(['destroy', this._domainName]);
    if (!r.ok) throw new Error('Failed to stop VM: ' + r.stderr);
  }

  async screenshot() {
    if (!this._initialized) throw new Error('VM not initialized');
    const screenshotPath = path.join(os.tmpdir(), `qemu-screen-${Date.now()}.png`);
    const r = this._run(['screenshot', this._domainName, screenshotPath]);
    if (!r.ok) throw new Error('Failed to capture screen: ' + r.stderr);
    const buffer = fs.readFileSync(screenshotPath);
    fs.rmSync(screenshotPath);
    return buffer.toString('base64');
  }

  async sendMouse(x, y, button) {
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
    this._run(['send-key', this._domainName, '--keycode', `KEY_${key.toUpperCase()}`]);
  }

  async createSnapshot(name) {
    if (!this._initialized) throw new Error('VM not initialized');
    const r = this._run(['snapshot-create-as', this._domainName, name]);
    if (!r.ok) throw new Error('Failed to create snapshot: ' + r.stderr);
  }

  async revertSnapshot(name) {
    if (!this._initialized) throw new Error('VM not initialized');
    const r = this._run(['snapshot-revert', this._domainName, name]);
    if (!r.ok) throw new Error('Failed to revert snapshot: ' + r.stderr);
  }

  async readFile(filePath) {
    if (!this._initialized) await this.init();
    // Open file via guest agent
    const openResult = this._run([
      'qemu-agent-command', this._domainName,
      JSON.stringify({ execute: 'guest-file-open', arguments: { path: filePath, mode: 'r' } }),
    ]);
    if (!openResult.ok) throw new Error('Failed to open file: ' + openResult.stderr);
    let handle;
    try { handle = JSON.parse(openResult.stdout).return; } catch { throw new Error('Failed to parse file handle'); }
    // Read file
    const readResult = this._run([
      'qemu-agent-command', this._domainName,
      JSON.stringify({ execute: 'guest-file-read', arguments: { handle, count: 1048576 } }),
    ]);
    if (!readResult.ok) throw new Error('Failed to read file');
    // Close
    this._run(['qemu-agent-command', this._domainName, JSON.stringify({ execute: 'guest-file-close', arguments: { handle } })]);
    try {
      const base64 = JSON.parse(readResult.stdout).return['buf-b64'] || '';
      return Buffer.from(base64, 'base64').toString('utf-8');
    } catch { return ''; }
  }

  async writeFile(filePath, content) {
    if (!this._initialized) await this.init();
    // Open file via guest agent
    const openResult = this._run([
      'qemu-agent-command', this._domainName,
      JSON.stringify({ execute: 'guest-file-open', arguments: { path: filePath, mode: 'w' } }),
    ]);
    if (!openResult.ok) throw new Error('Failed to open file for writing');
    let handle;
    try { handle = JSON.parse(openResult.stdout).return; } catch { throw new Error('Failed to parse file handle'); }
    // Write via base64
    const b64 = Buffer.from(content, 'utf-8').toString('base64');
    const writeResult = this._run([
      'qemu-agent-command', this._domainName,
      JSON.stringify({ execute: 'guest-file-write', arguments: { handle, 'buf-b64': b64 } }),
    ]);
    if (!writeResult.ok) throw new Error('Failed to write file');
    // Close
    this._run(['qemu-agent-command', this._domainName, JSON.stringify({ execute: 'guest-file-close', arguments: { handle } })]);
  }

  async listFiles(dirPath) {
    if (!this._initialized) await this.init();
    const r = await this.exec(`ls -1 ${_shQuote(dirPath || '.')}`);
    if (!r.ok) throw new Error('Failed to list files');
    return r.output.split('\n').filter(Boolean);
  }

  async deleteFile(filePath) {
    if (!this._initialized) await this.init();
    await this.exec(`rm -f ${_shQuote(filePath)}`);
  }

  async destroy() {
    if (this._initialized) {
      this._run(['destroy', this._domainName]);
      this._run(['undefine', this._domainName]);
    }
    this._initialized = false;
  }
}

module.exports = { QEMUBackend };
