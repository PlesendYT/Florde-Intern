const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache']);
const MAX_MANIFEST_FILES = 5000;

async function buildManifest(root) {
  const files = [];
  const stack = [''];
  while (stack.length > 0 && files.length < MAX_MANIFEST_FILES) {
    const rel = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const childRel = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(childRel);
      } else if (e.isFile()) {
        let stat;
        try {
          stat = fs.statSync(path.join(root, childRel));
        } catch {
          continue;
        }
        files.push({ rel: childRel, size: stat.size, mtimeMs: stat.mtimeMs });
        if (files.length >= MAX_MANIFEST_FILES) break;
      }
    }
  }
  return files;
}

class DryRunService {
  constructor(options = {}) {
    this._tmpBase = options.tmpBase || path.join(os.tmpdir(), 'florde-dryrun');
    this._runGit = options.runGit || execFileAsync;
  }

  async _isGitRepo(dir) {
    try {
      await this._runGit('git', ['-C', dir, 'rev-parse', '--git-dir'], { timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }

  _workspaceDir(projectName) {
    const safe = String(projectName).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'project';
    return path.join(this._tmpBase, safe + '-' + Date.now());
  }

  async start(projectName, opts = {}) {
    const projectRoot = opts.projectRoot;
    if (!projectRoot || !fs.existsSync(projectRoot)) {
      return { ok: false, error: 'project root not found' };
    }
    const dest = this._workspaceDir(projectName);
    fs.mkdirSync(dest, { recursive: true });
    if (await this._isGitRepo(projectRoot)) {
      const branch = 'florde-dryrun-' + Date.now();
      try {
        await this._runGit('git', ['worktree', 'add', '--detach', dest, 'HEAD'], { cwd: projectRoot, timeout: 60000 });
      } catch (e) {
        return { ok: false, error: 'git worktree failed: ' + e.message };
      }
      return { ok: true, kind: 'worktree', path: dest, branch, manifest: await buildManifest(dest) };
    }
    try {
      fs.cpSync(projectRoot, dest, {
        recursive: true,
        filter: (src) => !SKIP_DIRS.has(path.basename(src)),
      });
    } catch (e) {
      return { ok: false, error: 'copy failed: ' + e.message };
    }
    return { ok: true, kind: 'copy', path: dest, branch: null, manifest: await buildManifest(dest) };
  }

  async cleanup(projectName, session) {
    const wsPath = session && session.workspace && session.workspace.path;
    try {
      if (session && session.workspace && session.workspace.kind === 'worktree') {
        await this._runGit('git', ['worktree', 'remove', '--force', wsPath], { timeout: 60000 }).catch(() => {});
      }
    } finally {
      if (wsPath) fs.rmSync(wsPath, { recursive: true, force: true });
    }
    return { ok: true };
  }

  async orphans() {
    let entries;
    try {
      entries = fs.readdirSync(this._tmpBase, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries.filter((e) => e.isDirectory()).map((e) => ({ path: path.join(this._tmpBase, e.name) }));
  }
}

module.exports = { DryRunService, SKIP_DIRS, MAX_MANIFEST_FILES };
