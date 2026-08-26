const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { VMWareBackend } = require('../backends/vmware');

describe('VMWareBackend', () => {
  let workspaceDir;
  let backend;

  before(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmware-backend-test-'));
    backend = new VMWareBackend(workspaceDir);
  });

  after(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  describe('metadata', () => {
    it('should have type "vmware"', () => assert.strictEqual(backend.type, 'vmware'));
    it('should have a label', () => assert.ok(backend.label.length > 0));
    it('should have a description', () => assert.ok(backend.description.length > 0));
  });

  describe('isAvailable', () => {
    it('should return boolean', async () => {
      const result = await backend.isAvailable();
      assert.strictEqual(typeof result, 'boolean');
    });
  });

  describe('VM methods (throw when not initialized)', () => {
    it('startVM should throw when not initialized', async () => {
      await assert.rejects(() => backend.startVM(), /not initialized/i);
    });
    it('stopVM should throw when not initialized', async () => {
      await assert.rejects(() => backend.stopVM(), /not initialized/i);
    });
    it('screenshot should throw when not initialized', async () => {
      await assert.rejects(() => backend.screenshot(), /not initialized/i);
    });
    it('sendMouse should throw when not initialized', async () => {
      await assert.rejects(() => backend.sendMouse(100, 100, 'left'), /not initialized/i);
    });
    it('sendKey should throw when not initialized', async () => {
      await assert.rejects(() => backend.sendKey('enter'), /not initialized/i);
    });
    it('createSnapshot should throw when not initialized', async () => {
      await assert.rejects(() => backend.createSnapshot('test'), /not initialized/i);
    });
    it('revertSnapshot should throw when not initialized', async () => {
      await assert.rejects(() => backend.revertSnapshot('test'), /not initialized/i);
    });
  });

  describe('template support', () => {
    it('should use provided template', () => {
      const custom = new VMWareBackend(workspaceDir, { template: 'ubuntuDesktop' });
      assert.strictEqual(custom._template, 'ubuntuDesktop');
    });
  });

  describe('destroy', () => {
    it('should not throw when not initialized', async () => {
      await backend.destroy();
      assert.strictEqual(backend.initialized, false);
    });
  });
});
