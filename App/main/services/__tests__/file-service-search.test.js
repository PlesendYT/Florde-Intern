const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// file-service.js requires 'electron' at top (which under plain node
// resolves to a path string, not { app, dialog }). Stub it in the require
// cache BEFORE requiring file-service, so session-mode search never touches
// the real Electron runtime. Only the require itself runs at load;
// app.getPath is called lazily inside methods, so this minimal stub suffices.
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: { app: { getPath: () => os.tmpdir() }, dialog: {} },
};

const { FileService } = require('../file-service');

describe('FileService.searchInFiles session symlink guard (4a wiring)', () => {
  let base, sessionRoot, outside, svc;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'filesvc-search-'));
    sessionRoot = path.join(base, 'ws');
    outside = path.join(base, 'outside');
    fs.mkdirSync(sessionRoot, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    svc = new FileService({});
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('skips an outside-pointing file symlink while still finding inside files', async () => {
    const outsideMarker = 'SECRET-OUTSIDE-MARKER-4a';
    const insideMarker = 'INSIDE-MARKER-4a';
    fs.writeFileSync(path.join(outside, 'secret.txt'), `top secret ${outsideMarker}\n`);
    fs.writeFileSync(path.join(sessionRoot, 'ok.txt'), `hello ${insideMarker}\n`);
    const evil = path.join(sessionRoot, 'evil');
    try {
      fs.symlinkSync(path.join(outside, 'secret.txt'), evil);
    } catch {
      return; // symlink creation disallowed; skip escape assertions
    }

    const outsideHits = await svc.searchInFiles('ignored-project', outsideMarker, {
      sessionRoot,
    });
    assert.deepStrictEqual(
      outsideHits,
      [],
      'session search must not return outside content via file symlink'
    );

    const insideHits = await svc.searchInFiles('ignored-project', insideMarker, {
      sessionRoot,
    });
    assert.ok(
      insideHits.some((r) => r.file === 'ok.txt'),
      'session search must still find inside files'
    );
  });
});
