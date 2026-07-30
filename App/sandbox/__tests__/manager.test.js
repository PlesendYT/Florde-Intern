const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { SandboxManager } = require('../manager');

describe('SandboxManager', () => {
  let workspaceDir;
  let manager;

  before(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-test-'));
    manager = new SandboxManager(workspaceDir);
  });

  after(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should register both backends', () => {
      assert.ok(manager._backends.has('none'));
      assert.ok(manager._backends.has('firejail'));
    });

    it('should set default activeType to none', () => {
      assert.strictEqual(manager._activeType, 'none');
    });
  });

  describe('backends getter', () => {
    it('should return an array of backend type names', () => {
      const names = manager.backends;
      assert.deepStrictEqual(names, ['none', 'firejail', 'docker', 'podman']);
    });
  });

  describe('activeType getter', () => {
    it('should return the current active backend type', () => {
      assert.strictEqual(manager.activeType, 'none');
    });
  });

  describe('active getter', () => {
    it('should return the backend instance for the active type', () => {
      assert.ok(manager.active);
      assert.strictEqual(manager.active.type, 'none');
    });
  });

  describe('switchBackend', () => {
    it('should switch to firejail backend', async () => {
      await manager.switchBackend('firejail');
      assert.strictEqual(manager.activeType, 'firejail');
      // Switch back to none
      await manager.switchBackend('none');
      assert.strictEqual(manager.activeType, 'none');
    });

    it('should be a no-op when switching to same type', async () => {
      const beforeBackend = manager.active;
      await manager.switchBackend('none');
      assert.strictEqual(manager.activeType, 'none');
      assert.strictEqual(manager.active, beforeBackend);
    });

    it('should throw for unknown backend type', async () => {
      await assert.rejects(
        () => manager.switchBackend('unknown'),
        { message: 'Unknown backend: unknown' }
      );
    });

    it('should destroy current backend and init next', async () => {
      const destroyMock = mock.fn();
      const initMock = mock.fn();

      const originalBackends = manager._backends;
      const mockNone = { type: 'none', initialized: true, destroy: destroyMock };
      const mockFirejail = { type: 'firejail', initialized: false, init: initMock };

      manager._backends = new Map([
        ['none', mockNone],
        ['firejail', mockFirejail],
      ]);
      manager._activeType = 'none';

      await manager.switchBackend('firejail');

      assert.strictEqual(destroyMock.mock.callCount(), 1);
      assert.strictEqual(initMock.mock.callCount(), 1);
      assert.strictEqual(manager.activeType, 'firejail');

      manager._backends = originalBackends;
      manager._activeType = 'none';
    });

    it('should not destroy if current is not initialized', async () => {
      const destroyMock = mock.fn();
      const initMock = mock.fn();

      const originalBackends = manager._backends;
      const mockNone = { type: 'none', initialized: false, destroy: destroyMock };
      const mockFirejail = { type: 'firejail', initialized: false, init: initMock };

      manager._backends = new Map([
        ['none', mockNone],
        ['firejail', mockFirejail],
      ]);
      manager._activeType = 'none';

      await manager.switchBackend('firejail');

      assert.strictEqual(destroyMock.mock.callCount(), 0);
      assert.strictEqual(initMock.mock.callCount(), 1);
      assert.strictEqual(manager.activeType, 'firejail');

      manager._backends = originalBackends;
      manager._activeType = 'none';
    });

    it('should not init if next is already initialized', async () => {
      const destroyMock = mock.fn();
      const initMock = mock.fn();

      const originalBackends = manager._backends;
      const mockNone = { type: 'none', initialized: true, destroy: destroyMock };
      const mockFirejail = { type: 'firejail', initialized: true, init: initMock };

      manager._backends = new Map([
        ['none', mockNone],
        ['firejail', mockFirejail],
      ]);
      manager._activeType = 'none';

      await manager.switchBackend('firejail');

      assert.strictEqual(destroyMock.mock.callCount(), 1);
      assert.strictEqual(initMock.mock.callCount(), 0);
      assert.strictEqual(manager.activeType, 'firejail');

      manager._backends = originalBackends;
      manager._activeType = 'none';
    });
  });

  describe('exec', () => {
    it('should delegate to active backend', async () => {
      const result = await manager.exec('echo hello');
      assert.strictEqual(result.ok, true);
      assert.ok(result.output.includes('hello'));
    });

    it('should emit exec event', async () => {
      const events = [];
      manager.on('exec', (data) => events.push(data));

      await manager.exec('echo event-test');

      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].command, 'echo event-test');

      manager.off('exec', events[0]);
    });
  });

  describe('event system', () => {
    it('should emit switch event on switchBackend', async () => {
      const events = [];
      const handler = (data) => events.push(data);
      manager.on('switch', handler);

      await manager.switchBackend('firejail');
      await manager.switchBackend('none');

      assert.strictEqual(events.length, 2);
      assert.strictEqual(events[0].type, 'firejail');
      assert.strictEqual(events[1].type, 'none');

      manager.off('switch', handler);
    });

    it('should not emit switch event on no-op', async () => {
      const events = [];
      const handler = (data) => events.push(data);
      manager.on('switch', handler);

      await manager.switchBackend('none');

      assert.strictEqual(events.length, 0);

      manager.off('switch', handler);
    });

    it('should allow removing listeners with off', async () => {
      let callCount = 0;
      const handler = () => { callCount++; };

      manager.on('exec', handler);
      manager.off('exec', handler);

      await manager.exec('echo ghost');

      assert.strictEqual(callCount, 0);
    });

    it('should support multiple listeners for same event', async () => {
      let count1 = 0;
      let count2 = 0;
      const handler1 = () => { count1++; };
      const handler2 = () => { count2++; };

      manager.on('exec', handler1);
      manager.on('exec', handler2);

      await manager.exec('echo multi');

      assert.strictEqual(count1, 1);
      assert.strictEqual(count2, 1);

      manager.off('exec', handler1);
      manager.off('exec', handler2);
    });
  });

  describe('filesystem delegation', () => {
    before(async () => {
      if (manager.activeType !== 'none') await manager.switchBackend('none');
    });

    it('readFile should delegate to active backend', async () => {
      await manager.writeFile('test-read.txt', 'read content');
      const content = await manager.readFile('test-read.txt');
      assert.strictEqual(content, 'read content');
    });

    it('writeFile should delegate to active backend', async () => {
      await manager.writeFile('test-write.txt', 'write content');
      const content = fs.readFileSync(path.join(workspaceDir, 'test-write.txt'), 'utf-8');
      assert.strictEqual(content, 'write content');
    });

    it('listFiles should delegate to active backend', async () => {
      fs.writeFileSync(path.join(workspaceDir, 'list-a.txt'), '');
      const files = await manager.listFiles('');
      assert.ok(files.includes('list-a.txt'));
    });

    it('deleteFile should delegate to active backend', async () => {
      const testPath = path.join(workspaceDir, 'to-delete.txt');
      fs.writeFileSync(testPath, 'bye');
      await manager.deleteFile('to-delete.txt');
      assert.strictEqual(fs.existsSync(testPath), false);
    });
  });

  describe('VM operations', () => {
    before(async () => {
      if (manager.activeType !== 'none') await manager.switchBackend('none');
    });

    it('screenshot should throw on non-VM backend', async () => {
      await assert.rejects(
        () => manager.screenshot(),
        { message: /VM operations not supported/ }
      );
    });

    it('sendMouse should throw on non-VM backend', async () => {
      await assert.rejects(
        () => manager.sendMouse(100, 200, 'left'),
        { message: /VM operations not supported/ }
      );
    });

    it('sendKey should throw on non-VM backend', async () => {
      await assert.rejects(
        () => manager.sendKey('enter'),
        { message: /VM operations not supported/ }
      );
    });

    it('createSnapshot should throw on non-VM backend', async () => {
      await assert.rejects(
        () => manager.createSnapshot('snap1'),
        { message: /VM operations not supported/ }
      );
    });

    it('revertSnapshot should throw on non-VM backend', async () => {
      await assert.rejects(
        () => manager.revertSnapshot('snap1'),
        { message: /VM operations not supported/ }
      );
    });
  });

  describe('SystemDetector delegation', () => {
    it('detect should return system detection result', async () => {
      const result = await manager.detect();
      assert.ok(result.cpu);
      assert.ok(result.ram);
      assert.ok(result.os);
      assert.ok(result.gpu);
      assert.ok(result.tools);
    });

    it('recommend should return sorted recommendations', async () => {
      const spec = {
        ram: { total: 0 },
        cpu: { cores: 0 },
        gpu: { model: 'none', vram: 0 },
        tools: { docker: false, podman: false, firejail: false, vmware: false },
        os: { platform: 'linux' },
        hasVisionModel: false,
      };
      const recs = await manager.recommend(spec);
      assert.ok(recs.length >= 1);
      assert.strictEqual(recs[0].type, 'none');
    });
  });
});
