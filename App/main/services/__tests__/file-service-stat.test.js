const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Same electron stub as file-service-search.test.js: file-service.js requires
// 'electron' at top; stub before requiring so plain node never touches Electron.
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: { app: { getPath: () => os.tmpdir() }, dialog: {} },
};

const { FileService } = require('../file-service');

describe('FileService.statProjectFile (dry-run conflict check)', () => {
  let base, sessionRoot, svc;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'filesvc-stat-'));
    sessionRoot = path.join(base, 'ws');
    fs.mkdirSync(sessionRoot, { recursive: true });
    svc = new FileService({});
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('returns {size, mtimeMs} for a session file', () => {
    fs.writeFileSync(path.join(sessionRoot, 'a.txt'), 'hello');
    const st = svc.statProjectFile('ignored-project', 'a.txt', { sessionRoot });
    const expected = fs.statSync(path.join(sessionRoot, 'a.txt'));
    assert.ok(st, 'stat should return an object');
    assert.strictEqual(st.size, expected.size);
    assert.strictEqual(st.mtimeMs, expected.mtimeMs);
    assert.deepStrictEqual(Object.keys(st).sort(), ['mtimeMs', 'size']);
  });

  it('returns null for missing session file, escapes, and invalid sessionRoot', () => {
    assert.strictEqual(svc.statProjectFile('ignored-project', 'missing.txt', { sessionRoot }), null);
    assert.strictEqual(svc.statProjectFile('ignored-project', '../evil.txt', { sessionRoot }), null);
    assert.strictEqual(svc.statProjectFile('ignored-project', '/abs.txt', { sessionRoot }), null);
    assert.strictEqual(svc.statProjectFile('ignored-project', 'a.txt', { sessionRoot: path.join(base, 'nope') }), null);
    assert.strictEqual(svc.statProjectFile('ignored-project', 'a.txt', { sessionRoot: '' }), null);
  });

  it('returns null in legacy mode for unknown project (never throws)', () => {
    assert.strictEqual(svc.statProjectFile('no-such-project-xyz', 'a.txt'), null);
  });
});
