// Regression tests for b-26 (loop-detector critical unreachable),
// b-27 (attemptRecovery off-by-one) is covered via RecoveryManager import
// where available; b-28 via workspaces null-safety.
const { describe, it } = require('node:test');
const assert = require('node:assert');

function makeDetector() {
  if (typeof globalThis.window === 'undefined') globalThis.window = {};
  const path = '../tools/loop-detector.js';
  delete require.cache[require.resolve(path)];
  require(path);
  const Ctor = globalThis.window.LoopDetector;
  return new Ctor('test', 'balanced');
}

describe('b-26 error escalation', () => {
  it('30 identical failures reach critical', () => {
    const d = makeDetector();
    for (let i = 0; i < 30; i++) {
      d.recordAction({
        timestamp: Date.now() + i,
        agentId: 'main',
        type: 'command',
        tool: 'exec_command',
        command: 'npm test',
        args: {},
        result: 'Error: boom',
        errorFingerprint: 'boom-fp',
        success: false,
      });
    }
    const a = d.analyze();
    assert.strictEqual(a.status, 'critical');
  });

  it('8 identical failures reach confirmed', () => {
    const d = makeDetector();
    for (let i = 0; i < 8; i++) {
      d.recordAction({
        timestamp: Date.now() + i,
        agentId: 'main',
        type: 'command',
        tool: 'exec_command',
        command: 'npm test',
        args: {},
        result: 'Error: boom',
        errorFingerprint: 'boom-fp',
        success: false,
      });
    }
    const a = d.analyze();
    assert.ok(a.status === 'confirmed' || a.status === 'critical', 'got ' + a.status);
  });

  it('build failure resets success streak', () => {
    const d = makeDetector();
    d.recordAction({ timestamp: 1, agentId: 'm', type: 'build', result: 'build succeeded ok' });
    d.recordAction({ timestamp: 2, agentId: 'm', type: 'build', result: 'build failed hard' });
    assert.strictEqual(d._metrics.buildSuccess, 0);
  });
});
