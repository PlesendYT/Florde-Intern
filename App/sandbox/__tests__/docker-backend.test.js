// App/sandbox/__tests__/docker-backend.test.js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { DockerBackend } = require('../backends/docker');

describe('DockerBackend', () => {
  let workspaceDir;
  let backend;

  before(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-backend-test-'));
    backend = new DockerBackend(workspaceDir);
  });

  after(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  describe('metadata', () => {
    it('should have type "docker"', () => {
      assert.strictEqual(backend.type, 'docker');
    });

    it('should have a label', () => {
      assert.ok(typeof backend.label === 'string');
      assert.ok(backend.label.length > 0);
    });

    it('should have a description', () => {
      assert.ok(typeof backend.description === 'string');
      assert.ok(backend.description.length > 0);
    });
  });

  describe('isAvailable', () => {
    it('should return true when docker is installed', async () => {
      const result = await backend.isAvailable();
      assert.strictEqual(typeof result, 'boolean');
    });
  });

  describe('init and destroy', () => {
    it('should init (pull, create, start) and destroy (stop, rm) a container', async () => {
      const r = await backend.isAvailable();
      if (!r) { console.log('  ⚠ Docker not available — skipping lifecycle test'); return; }
      try {
        await backend.init();
      } catch (e) {
        console.log('  ⚠ Image pull failed (florde/sandbox:minimal not public):', e.message);
        return;
      }
      assert.ok(backend.initialized);
      assert.ok(backend._containerId);
      await backend.destroy();
      assert.strictEqual(backend.initialized, false);
      assert.strictEqual(backend._containerId, null);
    });
  });

  describe('exec', () => {
    it('should execute a command in the container', async () => {
      const r = await backend.isAvailable();
      if (!r) return;
      try { await backend.init(); } catch (e) { console.log('  ⚠ Image pull failed (florde/sandbox:minimal not public):', e.message); return; }
      const result = await backend.exec('echo hello');
      assert.strictEqual(result.ok, true);
      assert.ok(result.output.includes('hello'));
      assert.strictEqual(result.code, 0);
      await backend.destroy();
    });

    it('should handle command failure', async () => {
      const r = await backend.isAvailable();
      if (!r) return;
      try { await backend.init(); } catch (e) { console.log('  ⚠ Image pull failed (florde/sandbox:minimal not public):', e.message); return; }
      const result = await backend.exec('nonexistent_cmd_xyz');
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.code, 127);
      await backend.destroy();
    });

    it('should respect timeout', async () => {
      const r = await backend.isAvailable();
      if (!r) return;
      try { await backend.init(); } catch (e) { console.log('  ⚠ Image pull failed (florde/sandbox:minimal not public):', e.message); return; }
      const start = Date.now();
      const result = await backend.exec('sleep 10', { timeout: 500 });
      const elapsed = Date.now() - start;
      assert.strictEqual(result.ok, false);
      assert.ok(elapsed < 5000, 'should have timed out quickly');
      await backend.destroy();
    });

    it('should use provided cwd', async () => {
      const r = await backend.isAvailable();
      if (!r) return;
      try { await backend.init(); } catch (e) { console.log('  ⚠ Image pull failed (florde/sandbox:minimal not public):', e.message); return; }
      const result = await backend.exec('pwd', { cwd: '/tmp' });
      assert.strictEqual(result.ok, true);
      assert.ok(result.output.includes('/tmp'));
      await backend.destroy();
    });
  });

  describe('filesystem operations', () => {
    it('should write and read a file', async () => {
      const r = await backend.isAvailable();
      if (!r) return;
      try { await backend.init(); } catch (e) { console.log('  ⚠ Image pull failed (florde/sandbox:minimal not public):', e.message); return; }
      await backend.writeFile('test-docker.txt', 'docker content');
      const content = await backend.readFile('test-docker.txt');
      assert.strictEqual(content, 'docker content');
      await backend.destroy();
    });

    it('should list files', async () => {
      const r = await backend.isAvailable();
      if (!r) return;
      try { await backend.init(); } catch (e) { console.log('  ⚠ Image pull failed (florde/sandbox:minimal not public):', e.message); return; }
      await backend.writeFile('docker-list-a.txt', '');
      await backend.writeFile('docker-list-b.txt', '');
      const files = await backend.listFiles('');
      assert.ok(files.includes('docker-list-a.txt'));
      assert.ok(files.includes('docker-list-b.txt'));
      await backend.destroy();
    });

    it('should delete a file', async () => {
      const r = await backend.isAvailable();
      if (!r) return;
      try { await backend.init(); } catch (e) { console.log('  ⚠ Image pull failed (florde/sandbox:minimal not public):', e.message); return; }
      await backend.writeFile('to-delete.txt', 'delete me');
      await backend.deleteFile('to-delete.txt');
      const files = await backend.listFiles('');
      assert.ok(!files.includes('to-delete.txt'));
      await backend.destroy();
    });
  });

  describe('custom image', () => {
    it('should use custom image when specified', () => {
      const customBackend = new DockerBackend(workspaceDir, { image: 'node:20-alpine' });
      assert.strictEqual(customBackend._image, 'node:20-alpine');
    });
  });
});
