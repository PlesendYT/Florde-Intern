const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { VncStreamer } = require('../vnc-stream');

describe('VncStreamer', () => {
  let tmp;
  before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vncstream-')); });
  after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('should not throw on stop when not running', () => {
    const s = new VncStreamer({ host: '127.0.0.1', port: 5909 });
    s.stop();
    assert.strictEqual(s.running, false);
  });

  it('should reject start if already running', async () => {
    const s = new VncStreamer({ host: '127.0.0.1', port: 5909 });
    s.running = true;
    await assert.rejects(() => s.start(), /already running/);
    s.running = false;
  });
});
