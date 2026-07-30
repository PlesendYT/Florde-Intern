const { spawnSync } = require('child_process');
const crypto = require('crypto');
const { SandboxBackend } = require('../backend');

class DockerBackend extends SandboxBackend {
  get type() { return 'docker'; }
  get label() { return 'Docker Sandbox'; }
  get description() { return 'Container-basierte Ausführung über Docker. Jeder Befehl läuft in einem isolierten Container mit wählbarem Netzwerk.'; }
  get _binary() { return 'docker'; }

  constructor(workspaceDir, options = {}) {
    super();
    this._workspaceDir = workspaceDir;
    this._image = options.image || 'florde/sandbox:minimal';
    this._containerId = null;
    this._network = options.network || 'bridge';
  }

  _generateContainerName() {
    const suffix = crypto.randomBytes(4).toString('hex');
    return `florde-sbx-${suffix}`;
  }

  _run(args, timeout = 30000) {
    try {
      const r = spawnSync(this._binary, args, {
        timeout,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      const ok = r.status === 0 && !r.error && !r.signal;
      return { ok, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim(), code: r.status ?? -1 };
    } catch (e) {
      return { ok: false, stdout: '', stderr: e.message, code: -1 };
    }
  }

  async isAvailable() {
    const r = this._run(['info']);
    return r.ok;
  }

  async init() {
    if (this._initialized) return;
    const containerName = this._generateContainerName();
    this._containerName = containerName;

    // Pull image if not already present
    const pullResult = this._run(['pull', this._image], 120000);
    if (!pullResult.ok) {
      // If pull fails because image already exists locally in a tag mismatch, ignore
    }

    // Create container
    const createResult = this._run([
      'create', '--name', containerName,
      '--network', this._network,
      '-v', `${this._workspaceDir}:/workspace`,
      this._image,
      'sleep', 'infinity',
    ]);
    if (!createResult.ok) throw new Error('Failed to create container: ' + createResult.stderr);

    // Find the container ID
    const inspectResult = this._run(['inspect', '--format', '{{.Id}}', containerName]);
    this._containerId = inspectResult.ok ? inspectResult.stdout : containerName;

    // Start container
    const startResult = this._run(['start', containerName]);
    if (!startResult.ok) throw new Error('Failed to start container: ' + startResult.stderr);

    this._initialized = true;
  }

  async exec(command, options = {}) {
    if (!this._initialized) await this.init();
    const cwd = options.cwd || '/workspace';
    const timeout = options.timeout || 30000;

    const result = this._run([
      'exec', '-w', cwd, this._containerName,
      'sh', '-c', command,
    ], timeout);

    return { ok: result.ok, output: result.stdout || result.stderr, code: result.code };
  }

  async readFile(filePath) {
    if (!this._initialized) await this.init();
    const result = this._run(['exec', this._containerName, 'cat', `/workspace/${filePath}`]);
    if (!result.ok) throw new Error('Failed to read file: ' + result.stderr);
    return result.stdout;
  }

  async writeFile(filePath, content) {
    if (!this._initialized) await this.init();
    const dir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
    if (dir) {
      this._run(['exec', this._containerName, 'mkdir', '-p', `/workspace/${dir}`]);
    }
    const result = spawnSync(this._binary, ['exec', '-i', this._containerName, 'sh', '-c', `cat > /workspace/${filePath}`], {
      input: content,
      encoding: 'utf-8',
      timeout: 10000,
    });
    if (result.error || result.status !== 0) throw new Error('Failed to write file');
  }

  async listFiles(dirPath) {
    if (!this._initialized) await this.init();
    const target = dirPath ? `/workspace/${dirPath}` : '/workspace';
    const result = this._run(['exec', this._containerName, 'ls', '-1', target]);
    if (!result.ok) throw new Error('Failed to list files: ' + result.stderr);
    return result.stdout.split('\n').filter(Boolean);
  }

  async deleteFile(filePath) {
    if (!this._initialized) await this.init();
    const result = this._run(['exec', this._containerName, 'rm', '-f', `/workspace/${filePath}`]);
    if (!result.ok) throw new Error('Failed to delete file: ' + result.stderr);
  }

  async destroy() {
    if (this._containerName) {
      this._run(['stop', this._containerName]);
      this._run(['rm', '-f', this._containerName]);
      this._containerName = null;
      this._containerId = null;
    }
    this._initialized = false;
  }
}

module.exports = { DockerBackend };
