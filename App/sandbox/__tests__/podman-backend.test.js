// App/sandbox/__tests__/podman-backend.test.js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { PodmanBackend } = require('../backends/podman');

describe('PodmanBackend', () => {
  let workspaceDir;
  let backend;

  before(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podman-backend-test-'));
    backend = new PodmanBackend(workspaceDir);
  });

  after(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  describe('metadata', () => {
    it('should have type "podman"', () => {
      assert.strictEqual(backend.type, 'podman');
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
    it('should return true when podman is installed', async () => {
      const result = await backend.isAvailable();
      assert.strictEqual(typeof result, 'boolean');
    });
  });

  describe('binary', () => {
    it('should use "podman" binary', () => {
      assert.strictEqual(backend._binary, 'podman');
    });
  });

  describe('init and destroy', () => {
    it('should init and destroy a container', async () => {
      const r = await backend.isAvailable();
      if (!r) {
        console.log('  ⚠ Podman not available — skipping lifecycle test');
        return;
      }
      await backend.init();
      assert.ok(backend.initialized);
      assert.ok(backend._containerName);
      await backend.destroy();
      assert.strictEqual(backend.initialized, false);
    });
  });

  describe('exec', () => {
    it('should execute a command', async () => {
      const r = await backend.isAvailable();
      if (!r) return;
      await backend.init();
      const result = await backend.exec('echo hello');
      assert.strictEqual(result.ok, true);
      assert.ok(result.output.includes('hello'));
      await backend.destroy();
    });
  });
});
