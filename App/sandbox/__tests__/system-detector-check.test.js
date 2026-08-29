const { describe, it } = require('node:test');
const assert = require('node:assert');
const { SystemDetector } = require('../system-detector');

describe('SystemDetector._checkBinary injection safety', () => {
  it('should return false for malicious names', async () => {
    assert.strictEqual(await SystemDetector._checkBinary('; rm -rf /'), false);
    assert.strictEqual(await SystemDetector._checkBinary('foo; echo pwned'), false);
    assert.strictEqual(await SystemDetector._checkBinary('$(whoami)'), false);
    assert.strictEqual(await SystemDetector._checkBinary('../etc'), false);
  });
});
