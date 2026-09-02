import { test } from 'node:test';
import assert from 'node:assert';
import { getBaseTools, assessShellRisk, getBackoffDelay } from '../domains/tools/registry.js';

test('getBaseTools returns the expected base tool set', () => {
  const tools = getBaseTools();
  const names = tools.map(t => t.function.name);
  assert.ok(names.includes('read_file'));
  assert.ok(names.includes('write_file'));
  assert.ok(names.includes('exec_command'));
  assert.ok(names.includes('edit_file'));
  assert.ok(names.includes('spawn_subagent'));
  for (const t of tools) {
    assert.equal(t.type, 'function');
    assert.ok(t.function.parameters && t.function.parameters.properties);
  }
});

test('assessShellRisk: rm -rf / is critical', () => {
  assert.equal(assessShellRisk('rm -rf /'), 'critical');
});

test('assessShellRisk: sudo is high', () => {
  assert.equal(assessShellRisk('sudo apt install x'), 'high');
});

test('assessShellRisk: grep is safe', () => {
  assert.equal(assessShellRisk('grep -r foo .'), 'safe');
});

test('getBackoffDelay: exponential with 60s cap', () => {
  assert.equal(getBackoffDelay(0), 1000);
  assert.equal(getBackoffDelay(1), 2000);
  assert.equal(getBackoffDelay(2), 4000);
  assert.equal(getBackoffDelay(6), 60000); // 64000 -> capped
  assert.equal(getBackoffDelay(10), 60000);
});
