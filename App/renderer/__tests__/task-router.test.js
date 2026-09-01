import { test } from 'node:test';
import assert from 'node:assert';
import { createTaskRouter } from '../domains/task-router/task-router.js';

const TASK_DEFAULTS = {
  coding: false, chatting: true, planning: false, brainstorming: true,
  vision: false, image_generation: false, tool_calling: false,
  experimental_tool_calling: false
};
const META = {
  'gpt-4o': { tasks: { ...TASK_DEFAULTS, coding: true }, free: false, costIn: 5 },
  'deepseek-chat': { tasks: { ...TASK_DEFAULTS, coding: true }, free: true, costIn: 0 }
};

function makeRouter(overrides = {}) {
  const taskModels = {};
  const taskProviders = {};
  const disabledTasks = {};
  const store = { openai: { model: 'gpt-4o' }, deepseek: { model: 'deepseek-chat' } };
  return createTaskRouter({
    mode: 'manual',
    taskModels,
    taskProviders,
    disabledTasks,
    meta: META,
    taskDefaults: TASK_DEFAULTS,
    providerStore: store,
    routes: [],
    providerFactory: (pid, model) => ({ providerId: pid, model }),
    ...overrides
  });
}

test('handleFailure: rate limit with fallback → action fallback', () => {
  const r = makeRouter({ taskModels: { coding: 'gpt-4o' }, taskProviders: { coding: 'openai' } });
  const res = r.handleFailure('coding', 'gpt-4o', { message: 'Error 429 rate limit exceeded' });
  assert.strictEqual(res.action, 'fallback');
  assert.notStrictEqual(res.model, 'gpt-4o');
});

test('handleFailure: capability error without fallback → disable', () => {
  const r = makeRouter({ taskModels: { chatting: 'gpt-4o' }, taskProviders: { chatting: 'openai' } });
  const res = r.handleFailure('vision', 'gpt-4o', { message: 'does not support vision' });
  assert.strictEqual(res.action, 'disable');
});

test('handleFailure: generic error → action error', () => {
  const r = makeRouter();
  const res = r.handleFailure('coding', 'gpt-4o', { message: 'network down' });
  assert.strictEqual(res.action, 'error');
});

test('getModelForTask: disabled task → null', () => {
  const r = makeRouter({ disabledTasks: { coding: true } });
  assert.strictEqual(r.getModelForTask('coding'), null);
});

test('getModelForTask: manual with no mapping → null', () => {
  const r = makeRouter();
  assert.strictEqual(r.getModelForTask('coding'), null);
});

test('getModelForTask: manual with mapping → provider+model', () => {
  const r = makeRouter({ taskModels: { coding: 'gpt-4o' }, taskProviders: { coding: 'openai' } });
  const res = r.getModelForTask('coding');
  assert.strictEqual(res.providerId, 'openai');
  assert.strictEqual(res.model, 'gpt-4o');
});

test('getModelForTask: attachedImages forces vision task type', () => {
  const r = makeRouter({ taskModels: { coding: 'gpt-4o', vision: 'gpt-4o' }, taskProviders: { coding: 'openai', vision: 'openai' } });
  const res = r.getModelForTask('coding', [{}]);
  assert.strictEqual(res.taskType, 'vision');
});

test('_autoSelect: prefers free capable model in auto mode', () => {
  const r = makeRouter({ mode: 'auto' });
  const res = r._autoSelect('coding');
  assert.strictEqual(res.model, 'deepseek-chat');
});
