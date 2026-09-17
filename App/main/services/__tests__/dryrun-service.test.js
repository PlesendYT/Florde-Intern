const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DryRunService, resolveSessionPath } = require('../dryrun-service');

describe('DryRunService copy workspace', () => {
  let tmp, proj, svc;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dryrun-'));
    proj = path.join(tmp, 'proj');
    fs.mkdirSync(path.join(proj, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'main.py'), 'print(1)');
    fs.writeFileSync(path.join(proj, 'sub', 'x.py'), 'x');
    fs.mkdirSync(path.join(proj, 'node_modules'));
    fs.writeFileSync(path.join(proj, 'node_modules', 'big.js'), 'x'.repeat(100));
    svc = new DryRunService({ tmpBase: path.join(tmp, 'ws') });
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('copies project minus excluded dirs with manifest', async () => {
    const r = await svc.start('p', { projectRoot: proj });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.kind, 'copy');
    assert.ok(fs.existsSync(path.join(r.path, 'main.py')));
    assert.ok(!fs.existsSync(path.join(r.path, 'node_modules')));
    assert.ok(r.manifest.some((f) => f.rel === 'main.py' && f.size === 8));
  });

  it('rejects missing project root', async () => {
    const r = await svc.start('p', { projectRoot: path.join(tmp, 'nope') });
    assert.strictEqual(r.ok, false);
  });

  it('cleanup removes the workspace', async () => {
    const r = await svc.start('p', { projectRoot: proj });
    await svc.cleanup('p', { workspace: { kind: r.kind, path: r.path } });
    assert.ok(!fs.existsSync(r.path));
  });

  it('orphans lists leftover workspaces', async () => {
    const r = await svc.start('p', { projectRoot: proj });
    const list = await svc.orphans();
    assert.ok(list.some((o) => o.path === r.path));
    await svc.cleanup('p', { workspace: { kind: r.kind, path: r.path } });
  });
});

describe('DryRunService git worktree workspace', () => {
  let tmp, repo, svc;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dryrun-git-'));
    repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    svc = new DryRunService({ tmpBase: path.join(tmp, 'ws') });
    try {
      execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
      fs.writeFileSync(path.join(repo, 'app.py'), 'print(2)');
      execFileSync('git', ['add', '-A'], { cwd: repo, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init'], { cwd: repo, stdio: 'ignore' });
    } catch {}
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('uses git worktree for git repos', async function () {
    try {
      execFileSync('git', ['--version'], { stdio: 'ignore' });
    } catch {
      this.skip();
    }
    const r = await svc.start('p', { projectRoot: repo });
    try {
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.kind, 'worktree');
      assert.ok(fs.existsSync(path.join(r.path, 'app.py')));
      assert.ok(Array.isArray(r.manifest));
    } finally {
      await svc.cleanup('p', { workspace: { kind: r.kind, path: r.path } });
    }
  });
});

describe('resolveSessionPath containment', () => {
  it('resolves inside paths against the session root', () => {
    assert.strictEqual(resolveSessionPath('/tmp/ws', 'main.py'), path.join(path.resolve('/tmp/ws'), 'main.py'));
    assert.strictEqual(resolveSessionPath('/tmp/ws', 'sub/x.py'), path.join(path.resolve('/tmp/ws'), 'sub', 'x.py'));
  });

  it('rejects .. breakout, absolute and empty input', () => {
    assert.strictEqual(resolveSessionPath('/tmp/ws', '../evil.py'), null);
    assert.strictEqual(resolveSessionPath('/tmp/ws', 'a/../../evil.py'), null);
    assert.strictEqual(resolveSessionPath('/tmp/ws', '/etc/passwd'), null);
    assert.strictEqual(resolveSessionPath('/tmp/ws', ''), null);
    assert.strictEqual(resolveSessionPath('/tmp/ws', '   '), null);
  });
});
