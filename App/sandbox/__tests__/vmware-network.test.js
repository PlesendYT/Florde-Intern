const { describe, it } = require('node:test');
const assert = require('node:assert');
const { VMWareBackend } = require('../backends/vmware');

describe('VMWareBackend network config', () => {
  it('should accept network option in constructor', () => {
    const b = new VMWareBackend('/tmp/work', { network: 'host-only' });
    assert.strictEqual(b.network, 'host-only');
  });
  it('should default to nat', () => {
    const b = new VMWareBackend('/tmp/work');
    assert.strictEqual(b.network, 'nat');
  });
});
