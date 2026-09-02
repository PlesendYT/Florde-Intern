import { test } from 'node:test';
import assert from 'node:assert';
import { createWorkspaces } from '../domains/workspace/workspaces.js';

test('seed adds default workspace when empty', () => {
  const ws = createWorkspaces();
  ws.seed({ workspaces: [] });
  assert.strictEqual(ws.size, 1);
  assert.strictEqual(ws.workspaces[0].id, 'default');
  assert.strictEqual(ws.workspaces[0].path, null);
  assert.strictEqual(ws.activeWorkspaceId, 'default');
});

test('seed loads saved workspaces and activates first', () => {
  const ws = createWorkspaces();
  ws.seed({ workspaces: [{ id: 'a', name: 'Alpha', path: '/x' }, { id: 'b', name: 'Beta', path: '/y' }] });
  assert.strictEqual(ws.size, 2);
  assert.strictEqual(ws.activeWorkspaceId, 'a');
  assert.strictEqual(ws.getActive().name, 'Alpha');
});

test('getActive returns null when none', () => {
  const ws = createWorkspaces();
  assert.strictEqual(ws.getActive(), null);
});

test('newWorkspace creates with generated id and display name', () => {
  const ws = createWorkspaces();
  const id = ws.newWorkspace('/proj/foo', '');
  assert.ok(id.startsWith('ws-'));
  assert.strictEqual(ws.getActive().id, id);
  assert.strictEqual(ws.getActive().name, 'foo');
  assert.strictEqual(ws.getActive().path, '/proj/foo');
});

test('newWorkspace uses provided name when given', () => {
  const ws = createWorkspaces();
  const id = ws.newWorkspace('/proj/foo', 'MeinProjekt');
  assert.strictEqual(ws.getActive().name, 'MeinProjekt');
});

test('getExistingByPath finds existing workspace', () => {
  const ws = createWorkspaces();
  const id = ws.newWorkspace('/proj/foo', 'Foo');
  const found = ws.getExistingByPath('/proj/foo');
  assert.ok(found);
  assert.strictEqual(found.id, id);
  assert.strictEqual(ws.getExistingByPath('/other'), undefined);
});

test('setActive switches active; false for unknown', () => {
  const ws = createWorkspaces();
  const a = ws.newWorkspace('/a', 'A');
  const b = ws.newWorkspace('/b', 'B');
  assert.strictEqual(ws.activeWorkspaceId, b);
  assert.strictEqual(ws.setActive(a), true);
  assert.strictEqual(ws.activeWorkspaceId, a);
  assert.strictEqual(ws.setActive('nope'), false);
});

test('closeWorkspace removes and neighbors to survivor', () => {
  const ws = createWorkspaces();
  const a = ws.newWorkspace('/a', 'A');
  const b = ws.newWorkspace('/b', 'B');
  const newActive = ws.closeWorkspace(a);
  assert.deepStrictEqual(ws.workspaces.map(w => w.id), [b]);
  assert.strictEqual(ws.activeWorkspaceId, b);
  assert.strictEqual(newActive, b);
});

test('closeWorkspace keeps at least one', () => {
  const ws = createWorkspaces();
  const a = ws.newWorkspace('/a', 'A');
  const res = ws.closeWorkspace(a);
  assert.strictEqual(ws.size, 1);
  assert.strictEqual(res, null);
});

test('closeWorkspace returns null for unknown id', () => {
  const ws = createWorkspaces();
  ws.newWorkspace('/a', 'A');
  const res = ws.closeWorkspace('nope');
  assert.strictEqual(res, null);
  assert.strictEqual(ws.size, 1);
});

test('closeWorkspace of non-active does not change active', () => {
  const ws = createWorkspaces();
  const a = ws.newWorkspace('/a', 'A');
  const b = ws.newWorkspace('/b', 'B');
  const c = ws.newWorkspace('/c', 'C');
  assert.strictEqual(ws.activeWorkspaceId, c);
  const newActive = ws.closeWorkspace(a);
  assert.strictEqual(ws.activeWorkspaceId, c);
  assert.strictEqual(newActive, c);
});

test('workspaces returns copy', () => {
  const ws = createWorkspaces();
  ws.newWorkspace('/a', 'A');
  const arr = ws.workspaces;
  arr.pop();
  assert.strictEqual(ws.size, 1);
});

test('newWorkspace with backslash path extracts last segment', () => {
  const ws = createWorkspaces();
  const id = ws.newWorkspace('C:\\Users\\me\\Projects\\MyApp', '');
  assert.strictEqual(ws.getActive().name, 'MyApp');
});
