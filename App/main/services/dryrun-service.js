const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache']);
const MAX_MANIFEST_FILES = 5000;

// Pure containment helper for session-aware file IPC: resolves a
// session-relative path against sessionRoot. Returns the absolute path
// inside sessionRoot, or null on escape (absolute input, `..` breakout,
// empty/blank, overlong, NUL, symlink escape). Mirrors the containment
// logic of resolveSafe in ./shared.js. No electron import: testable under
// plain node.
// Note: renderer `resolveInRoot` stays string-based by design — this main-
// layer helper is the enforcement point (it can use fs.realpathSync).
function resolveSessionPath(sessionRoot, relPath) {
  if (typeof sessionRoot !== 'string' || sessionRoot.length === 0 || sessionRoot.length > 1000) return null;
  if (typeof relPath !== 'string' || relPath.length === 0 || relPath.length > 1000) return null;
  if (/[\0]/.test(sessionRoot) || /[\0]/.test(relPath)) return null;
  if (relPath.trim() === '') return null;
  if (path.isAbsolute(relPath)) return null;
  if (/^[A-Za-z]:[\\/]/.test(relPath)) return null;
  const canonRoot = path.resolve(sessionRoot);
  const resolved = path.resolve(canonRoot, relPath);
  if (resolved === canonRoot) return resolved;
  if (!resolved.startsWith(canonRoot + path.sep)) return null;
  // Symlink escape: string-prefix containment can be bypassed by a symlink
  // inside the session pointing outside. Resolve the nearest existing
  // ancestor and verify it stays inside the realpath of sessionRoot.
  // Handles non-existent targets by realpath-ing the parent chain.
  let realRoot;
  try {
    realRoot = fs.realpathSync(canonRoot);
  } catch {
    return resolved; // session root itself missing — no symlink can exist inside
  }
  let cur = resolved;
  for (;;) {
    try {
      const realCur = fs.realpathSync(cur);
      if (realCur === realRoot || realCur.startsWith(realRoot + path.sep)) return resolved;
      return null;
    } catch (e) {
      if (e && e.code === 'ENOENT') {
        // Dangling symlink: the failing component itself is a link whose
        // target does not exist yet — writeFileSync would follow it outside.
        // Deny links; only descend for genuinely missing (non-link) parts.
        try {
          if (fs.lstatSync(cur).isSymbolicLink()) return null;
        } catch (le) {
          if (!(le && le.code === 'ENOENT')) return null;
        }
        const parent = path.dirname(cur);
        if (parent === cur) return null;
        cur = parent;
        continue;
      }
      return null;
    }
  }
}

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
      // N3 split: dest-built manifest stays the baseline for _changes
      // modified detection (session-at-start); source-built manifest is the
      // baseline for the Apply conflict check (real-at-start). git worktree
      // and copy both stamp fresh mtimes in dest, so a single manifest
      // cannot serve both checks without false positives on one side.
      const [manifest, sourceManifest] = await Promise.all([buildManifest(dest), buildManifest(projectRoot)]);
      return { ok: true, kind: 'worktree', path: dest, branch, manifest, sourceManifest };
    }
    try {
      fs.cpSync(projectRoot, dest, {
        recursive: true,
        filter: (src) => !SKIP_DIRS.has(path.basename(src)),
      });
    } catch (e) {
      return { ok: false, error: 'copy failed: ' + e.message };
    }
    const [manifest, sourceManifest] = await Promise.all([buildManifest(dest), buildManifest(projectRoot)]);
    return { ok: true, kind: 'copy', path: dest, branch: null, manifest, sourceManifest };
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

module.exports = { DryRunService, SKIP_DIRS, MAX_MANIFEST_FILES, resolveSessionPath };
