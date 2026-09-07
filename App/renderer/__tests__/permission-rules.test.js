import { test } from 'node:test';
import assert from 'node:assert';
import { createPermissionRules } from '../domains/permission/rules.js';

test('get defaults to ask for unknown tool (secure default, F9)', () => {
  const p = createPermissionRules();
  assert.strictEqual(p.get('nonesuch'), 'ask');
});

test('get returns explicit rule first', () => {
  const p = createPermissionRules();
  p.set('read_file', 'block');
  assert.strictEqual(p.get('read_file'), 'block');
});

test('get falls back to group rule', () => {
  const p = createPermissionRules();
  p.set('browser', 'block');
  assert.strictEqual(p.get('browser_open'), 'block');
  assert.strictEqual(p.get('browser_click'), 'block');
});

test('resolveGroup maps browser_/git_/exec_command', () => {
  const p = createPermissionRules();
  assert.strictEqual(p.resolveGroup('browser_open'), 'browser');
  assert.strictEqual(p.resolveGroup('git_status'), 'git');
  assert.strictEqual(p.resolveGroup('exec_command'), 'terminal');
});

test('resolveGroup maps mcp tools when passed', () => {
  const p = createPermissionRules({ mcpTools: ['notion_query'] });
  assert.strictEqual(p.resolveGroup('notion_query'), 'mcp');
  assert.strictEqual(p.resolveGroup('something_else'), null);
});

test('set stores level and returns it via get', () => {
  const p = createPermissionRules();
  p.set('write_file', 'allow');
  assert.strictEqual(p.get('write_file'), 'allow');
});

test('seed defaults missing tools to ask without touching set ones', () => {
  const p = createPermissionRules();
  p.set('read_file', 'block');
  p.seed(['read_file', 'write_file', 'exec_command']);
  assert.strictEqual(p.get('read_file'), 'block');
  assert.strictEqual(p.get('write_file'), 'ask');
  assert.strictEqual(p.get('exec_command'), 'ask');
});

test('isExcepted honors autoExceptions flags', () => {
  const p = createPermissionRules();
  const args = { path: '../secret' };
  assert.strictEqual(p.isExcepted('exec_command', { command: 'git status' }, { git: true }), true);
  assert.strictEqual(p.isExcepted('exec_command', { command: 'rm -rf' }, { shell: true }), true);
  assert.strictEqual(p.isExcepted('read_file', args, { outside: true }), true);
  assert.strictEqual(p.isExcepted('exec_command', { command: 'ls' }, { terminal: true }), true);
  assert.strictEqual(p.isExcepted('read_file', { path: 'x' }, { outside: true }), false);
});

test('rules getter returns a copy that does not mutate internal state', () => {
  const p = createPermissionRules();
  p.set('write_file', 'block');
  const rules = p.rules;
  rules.write_file = 'allow';
  assert.strictEqual(p.get('write_file'), 'block');
});

test('size reflects number of stored rules', () => {
  const p = createPermissionRules();
  p.set('a', 'ask');
  p.set('b', 'block');
  assert.strictEqual(p.size, 2);
});
