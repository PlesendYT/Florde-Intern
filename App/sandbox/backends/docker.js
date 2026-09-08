const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');
const { SandboxBackend } = require('../backend');

function projectHash(project) {
  return (project ? crypto.createHash('sha256').update(String(project)).digest('hex').substring(0, 12) : 'default');
}

// Security (b-07/b-08): POSIX single-quote for guest-shell interpolation.
function _shQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

class DockerBackend extends SandboxBackend {
  get type() { return 'docker'; }
  get label() { return 'Docker Sandbox'; }
  get description() { return 'Container-basierte Ausführung über Docker. Jeder Befehl läuft in einem isolierten Container mit wählbarem Netzwerk.'; }
  get _binary() { return 'docker'; }

  constructor(workspaceDir, options = {}) {
    super();
    this._workspaceDir = workspaceDir;
    this._image = options.image || 'florde/sandbox:bookworm';
    this._project = options.project || null;
    this.projectHash = projectHash(this._project);
    this._customTools = options.customTools || [];
    this._toolVolumes = [];
    this._containerId = null;
    this._containerName = null;
    this._network = options.network || 'bridge';
  }

  _buildArgs() {
    const args = [];
    if ((this._customTools || []).some(t => t.type === 'compiler' || t.name === 'gcc')) args.push('--build-arg', 'WITH_COMPILER=1');
    if ((this._customTools || []).some(t => t.type === 'node' || t.name === 'nodejs')) args.push('--build-arg', 'WITH_NODE=1');
    return args;
  }

  _ensureImage() {
    const check = this._run(['image', 'inspect', this._image], 15000);
    if (check.ok) return true;
    const dockerfileDir = path.resolve(__dirname, '..', '..', 'docker', 'sandbox');
    const buildArgs = this._buildArgs();
    const args = ['build', '-t', this._image, '-f', path.join(dockerfileDir, 'Dockerfile')].concat(buildArgs, [dockerfileDir]);
    const r = this._run(args, 180000);
    if (!r.ok) throw new Error('Failed to build sandbox image: ' + r.stderr);
    return true;
  }

  _resolvePath(filePath) {
    const resolved = path.resolve('/workspace', filePath);
    if (!resolved.startsWith('/workspace/') && resolved !== '/workspace') {
      throw new Error('Access denied: path traversal detected');
    }
    return resolved;
  }

  _generateContainerName() {
    const suffix = crypto.randomBytes(4).toString('hex');
    return `florde-sbx-${suffix}`;
  }

  _run(args, timeout = 30000, input = null) {
    try {
      const opts = {
        timeout,
        encoding: 'utf-8',
        stdio: 'pipe',
      };
      if (input !== null) opts.input = input;
      const r = spawnSync(this._binary, args, opts);
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

    // Ensure image is built and create tool volumes
    this._ensureImage();
    this._toolVolumes = [];
    const projVol = 'florde-sbx-' + this.projectHash + '-tools';
    this._run(['volume', 'create', projVol], 15000);
    this._toolVolumes.push({ name: projVol, target: '/opt/custom-tools' });
    const globalVol = 'florde-tools-global';
    this._run(['volume', 'create', globalVol], 15000);
    this._toolVolumes.push({ name: globalVol, target: '/opt/global-tools' });

    // Create container
    const volumeArgs = [];
    for (const v of this._toolVolumes) { volumeArgs.push('-v', v.name + ':' + v.target); }
    const createResult = this._run([
      'create', '--name', containerName,
      '--network', this._network,
      '-v', `${this._workspaceDir}:/workspace`,
      ...volumeArgs,
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

    const output = result.stderr ? `${result.stdout}\n${result.stderr}`.trim() : result.stdout;
    return { ok: result.ok, output, code: result.code };
  }

  async readFile(filePath) {
    if (!this._initialized) await this.init();
    const target = this._resolvePath(filePath);
    const result = this._run(['exec', this._containerName, 'cat', target]);
    if (!result.ok) throw new Error('Failed to read file: ' + result.stderr);
    return result.stdout;
  }

  async writeFile(filePath, content) {
    if (!this._initialized) await this.init();
    const target = this._resolvePath(filePath);
    const dir = target.includes('/') ? target.substring(0, target.lastIndexOf('/')) : '';
    if (dir) {
      this._run(['exec', this._containerName, 'mkdir', '-p', dir]);
    }
    // Security (b-07): target is guest-shell-quoted — _resolvePath only jails
    // the prefix, metacharacters would break out of `cat > ...` otherwise.
    const result = this._run(['exec', '-i', this._containerName, 'sh', '-c', `cat > ${_shQuote(target)}`], 10000, content);
    if (!result.ok) throw new Error('Failed to write file');
  }

  async listFiles(dirPath) {
    if (!this._initialized) await this.init();
    const target = this._resolvePath(dirPath || '');
    const result = this._run(['exec', this._containerName, 'ls', '-1', target]);
    if (!result.ok) throw new Error('Failed to list files: ' + result.stderr);
    return result.stdout.split('\n').filter(Boolean);
  }

  async deleteFile(filePath) {
    if (!this._initialized) await this.init();
    const target = this._resolvePath(filePath);
    const result = this._run(['exec', this._containerName, 'rm', '-f', target]);
    if (!result.ok) throw new Error('Failed to delete file: ' + result.stderr);
  }

  async destroy() {
    // Security (b-33): state reset in finally — a failed stop/rm must not
    // leave a half-destroyed backend marked initialized.
    // NOTE: named tool volumes persist by design (custom tools survive
    // container recreation); see removeVolumes() for explicit cleanup.
    try {
      if (this._containerName) {
        this._run(['stop', this._containerName]);
        this._run(['rm', '-f', this._containerName]);
      }
    } finally {
      this._containerName = null;
      this._containerId = null;
      this._initialized = false;
    }
  }

  // Explicit cleanup for orphaned per-project tool volumes (b-33).
  async removeVolumes() {
    for (const v of this._toolVolumes || []) {
      try { this._run(['volume', 'rm', '-f', v.name]); } catch {}
    }
    this._toolVolumes = [];
  }
}

module.exports = { DockerBackend };
