const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PermissionStore } = require('../permission-store');
const { PermissionGate } = require('../permission-gate');

// Wir testen das Zusammenspiel von Gate + Store über die neue exec-Methode,
// ohne echtes Docker. Der manager wird durch einen Stub ersetzt.
test('exec routes through gate and runs manager.exec on allow', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svinteg-'));
  const store = new PermissionStore(path.join(dir, 'db.sqlite'));
  store.init();
  const gate = new PermissionGate({ store });

  const { SandboxService } = require('../sandbox-service');
  // sandboxDir wird injiziert, damit der interne SandboxManager ohne Electron
  // (app.getPath ist unter plain node nicht verfügbar) konstruierbar ist.
  const service = new SandboxService({ send: () => {}, projectRegistry: () => null, sandboxDir: dir });
  let called = false;
  service._manager.exec = async () => { called = true; return { ok: true, output: 'x', code: 0 }; };
  service._setGateForTest(gate);

  const out = await service.exec('ls', { project: 'p' });
  assert.equal(called, true);
  assert.equal(out.ok, true);
  service._manager.close && service._manager.close();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});