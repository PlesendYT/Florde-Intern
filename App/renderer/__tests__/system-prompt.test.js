import { test } from 'node:test';
import assert from 'node:assert';
import { buildSystemPromptText } from '../domains/prompt/system-prompt.js';

const base = {
  project: '/p',
  projectType: 'local',
  providerId: 'openai',
  memFiles: '',
  pluginSection: '',
  appsSection: '',
  customSection: '',
  promptExtSection: ''
};

test('hasTools=1 includes tool calling capabilities section', () => {
  const out = buildSystemPromptText({ ...base, hasTools: true });
  assert.ok(out.includes('You have tool calling capabilities'));
  assert.ok(out.includes('RULES:'));
  assert.ok(out.includes('read_file(path):'));
  assert.ok(out.includes('Florde AI, an AI coding assistant'));
});

test('no-tools variant includes WICHTIG block', () => {
  const out = buildSystemPromptText({ ...base, hasTools: false });
  assert.ok(out.includes('WICHTIG'));
  assert.ok(out.includes('Available Tools:'));
});

test('hasTools output is byte-exact (golden length) vs original template', () => {
  const out = buildSystemPromptText({ ...base, hasTools: true });
  assert.strictEqual(out.length, 2572);
  const idx = out.indexOf('You have tool calling capabilities');
  assert.strictEqual(out.slice(idx - 4, idx), '\n\n\n\n', 'must keep the original 4 newlines before the tool-calling heading');
});

test('privacy marks local providers as 100% Local', () => {
  const out = buildSystemPromptText({ ...base, hasTools: false, providerId: 'ollama' });
  assert.ok(out.includes('100% Local - no data leaves this PC'));
});

test('lmstudio and localai also marked as local', () => {
  assert.ok(buildSystemPromptText({ ...base, hasTools: false, providerId: 'lmstudio' }).includes('100% Local - no data leaves this PC'));
  assert.ok(buildSystemPromptText({ ...base, hasTools: false, providerId: 'localai' }).includes('100% Local - no data leaves this PC'));
});

test('cloud provider privacy line', () => {
  const out = buildSystemPromptText({ ...base, hasTools: false, providerId: 'openai' });
  assert.ok(out.includes('Cloud provider - data is encrypted in transit'));
});

test('project and type injected', () => {
  const out = buildSystemPromptText({ ...base, hasTools: false, project: '/mein/projekt', projectType: 'sandbox' });
  assert.ok(out.includes('Project: /mein/projekt'));
  assert.ok(out.includes('Type: sandbox'));
  assert.ok(out.includes('sandbox project. Files are stored in app data'));
});

test('local project notes line', () => {
  const out = buildSystemPromptText({ ...base, hasTools: false, projectType: 'local' });
  assert.ok(out.includes('local project. Shell commands run in the project root'));
});

test('memFiles section present when files given, absent when empty', () => {
  const withMem = buildSystemPromptText({ ...base, hasTools: true, memFiles: 'a.md, b.md' });
  assert.ok(withMem.includes('Persistent memory files (.florde/memory/): a.md, b.md'));
  const withoutMem = buildSystemPromptText({ ...base, hasTools: true, memFiles: '' });
  assert.ok(!withoutMem.includes('Persistent memory files'));
});

test('pluginSection and appsSection injected', () => {
  const out = buildSystemPromptText({ ...base, hasTools: false, pluginSection: '\n\nX: y', appsSection: '\n\nApps' });
  assert.ok(out.includes('X: y'));
  assert.ok(out.includes('Apps'));
});

test('customSection injected', () => {
  const out = buildSystemPromptText({ ...base, hasTools: false, customSection: '\n\nUser Custom Instructions:\ndo the thing' });
  assert.ok(out.includes('do the thing'));
});

test('promptExtSection injected', () => {
  const out = buildSystemPromptText({ ...base, hasTools: false, promptExtSection: '\n\n--- Plugin Extension (1) ---\next' });
  assert.ok(out.includes('--- Plugin Extension (1) ---'));
});

test('toolList default present; override honored', () => {
  const out = buildSystemPromptText({ ...base, hasTools: true });
  assert.ok(out.includes('- read_file(path): Read file content'));
  assert.ok(out.includes('- Plus connected service tools'));
  const over = buildSystemPromptText({ ...base, hasTools: true, toolList: '- custom_tool(x): X' });
  assert.ok(over.includes('- custom_tool(x): X'));
  assert.ok(!over.includes('read_file(path): Read file content'));
});
