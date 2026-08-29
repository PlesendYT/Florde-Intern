const { describe, it } = require('node:test');
const assert = require('node:assert');
const { SandboxManager } = require('../manager');

describe('SandboxManager network propagation', () => {
  it('should update network on the active VM backend', async () => {
    const mgr = new SandboxManager('/tmp/sbx');
    await mgr.switchBackend('vmware');
    mgr.setNetwork('host-only');
    assert.strictEqual(mgr.active.network, 'host-only');
  });
});