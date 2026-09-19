import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// RED: scripts/prepare-renderer-out.js spiegelt Classic-Scripts + Libs nach out/.
test('prepare helper exists', async () => {
  const mod = await import('../prepare-renderer-out.js');
  assert.ok(typeof mod.prepareRendererOut === 'function', 'prepareRendererOut missing');
  assert.ok(Array.isArray(mod.RENDERER_JS_DIRS), 'RENDERER_JS_DIRS missing');
  assert.ok(Array.isArray(mod.NODE_MODULES_MIRRORS), 'NODE_MODULES_MIRRORS missing');
});

test('copies renderer js tree preserving structure', async () => {
  const { prepareRendererOut } = await import('../prepare-renderer-out.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'florde-out-'));
  const rend = path.join(dir, 'renderer');
  fs.mkdirSync(path.join(rend, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(rend, 'script.js'), 'x');
  fs.writeFileSync(path.join(rend, 'tools', 'a.js'), 'y');
  fs.writeFileSync(path.join(rend, 'style.css'), 'z');
  const res = prepareRendererOut({ appDir: dir, outDir: path.join(dir, 'out'), rendererJs: true, nodeMirrors: [] });
  assert.ok(res.copied.includes('script.js'), 'top-level js copied');
  assert.ok(res.copied.includes('tools/a.js'), 'nested js copied');
  assert.ok(!res.copied.includes('style.css'), 'no css copied');
  assert.ok(fs.existsSync(path.join(dir, 'out', 'renderer', 'tools', 'a.js')));
  fs.rmSync(dir, { recursive: true });
});

test('mirrors node_modules trees for ../node_modules refs', async () => {
  const { prepareRendererOut } = await import('../prepare-renderer-out.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'florde-out-'));
  const nm = path.join(dir, 'node_modules', 'demo-pkg', 'lib');
  fs.mkdirSync(nm, { recursive: true });
  fs.writeFileSync(path.join(nm, 'x.js'), 'x');
  const res = prepareRendererOut({
    appDir: dir,
    outDir: path.join(dir, 'out'),
    rendererJs: false,
    nodeMirrors: [['node_modules/demo-pkg', 'node_modules/demo-pkg']],
  });
  assert.ok(fs.existsSync(path.join(dir, 'out', 'node_modules', 'demo-pkg', 'lib', 'x.js')));
  assert.deepStrictEqual(res.copied, []);
  fs.rmSync(dir, { recursive: true });
});

test('missing sources fail loudly', async () => {
  const { prepareRendererOut } = await import('../prepare-renderer-out.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'florde-out-'));
  assert.throws(() => prepareRendererOut({ appDir: dir, outDir: path.join(dir, 'out'), rendererJs: true, nodeMirrors: [] }), /renderer/);
  fs.rmSync(dir, { recursive: true });
});
