const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PermissionStore } = require('../permission-store');
const { PermissionGate, resolveToolCategory } = require('../permission-gate');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  const store = new PermissionStore(path.join(dir, 'db.sqlite'));
  store.init();
  return { store, dir };
}

test('resolveToolCategory maps ops', () => {
  assert.equal(resolveToolCategory('read_file'), 'file-read');
  assert.equal(resolveToolCategory('exec'), 'exec');
  assert.equal(resolveToolCategory('vm_snapshot'), 'vm-snapshot');
  assert.equal(resolveToolCategory('whatever'), 'whatever');
});

test('default: critical command is ask', async () => {
  const { store, dir } = setup();
  const gate = new PermissionGate({ store });
  const r = await gate.evaluate({ project: 'p', backend: 'docker', op: 'exec', command: 'sudo apt install x' });
  assert.equal(r.decision, 'ask');
  const safe = await gate.evaluate({ project: 'p', backend: 'docker', op: 'exec', command: 'ls' });
  assert.equal(safe.decision, 'allow');
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('allow rule on category allows', async () => {
  const { store, dir } = setup();
  store.set('p', 'sudo', 'allow');
  const gate = new PermissionGate({ store });
  const r = await gate.evaluate({ project: 'p', backend: 'docker', op: 'exec', command: 'sudo ls' });
  assert.equal(r.decision, 'allow');
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('block rule on category blocks', async () => {
  const { store, dir } = setup();
  store.set('p', 'sudo', 'block');
  const gate = new PermissionGate({ store });
  const r = await gate.evaluate({ project: 'p', backend: 'docker', op: 'exec', command: 'sudo ls' });
  assert.equal(r.decision, 'block');
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('regex rule path restricts action', async () => {
  const { store, dir } = setup();
  store.set('p', 'exec', 'allow', { path: 'regex:^apt-get install' });
  const gate = new PermissionGate({ store });
  const match = await gate.evaluate({ project: 'p', backend: 'docker', op: 'exec', command: 'apt-get install -y vim' });
  assert.equal(match.decision, 'allow');
  const other = await gate.evaluate({ project: 'p', backend: 'docker', op: 'exec', command: 'rm file' });
  assert.notEqual(other.decision, 'allow'); // keine Regex-Regel -> andere Pfade
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ask triggers askHandler and returns decision', async () => {
  const { store, dir } = setup();
  let asked = 0;
  let approve = 'allow';
  const gate = new PermissionGate({ store, askHandler: async (info) => {
    asked++;
    info.decision = approve;
    return approve;
  } });
  const r = await gate.evaluate({ project: 'p', backend: 'docker', op: 'exec', command: 'sudo ls' });
  assert.equal(asked, 1);
  assert.equal(r.decision, 'allow');
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('checkAndRun runs run() on allow', async () => {
  const { store, dir } = setup();
  const gate = new PermissionGate({ store });
  let ran = false;
  const out = await gate.checkAndRun({
    project: 'p', backend: 'docker', op: 'exec', command: 'ls',
    run: async () => { ran = true; return 'ok'; },
  });
  assert.equal(out, 'ok');
  assert.equal(ran, true);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('checkAndRun throws PermissionError on block', async () => {
  const { store, dir } = setup();
  store.set('p', 'file-delete', 'block');
  const gate = new PermissionGate({ store });
  await assert.rejects(
    gate.checkAndRun({ project: 'p', backend: 'docker', op: 'delete_file', path: '/a', run: async () => 'nope' }),
    /blocked/
  );
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
