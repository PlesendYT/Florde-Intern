import { test } from 'node:test';
import assert from 'node:assert';
import { createChatSessions } from '../domains/chat/sessions.js';

test('newSession creates and activates a session', () => {
  const s = createChatSessions();
  const id = s.newSession();
  assert.strictEqual(typeof id, 'number');
  assert.strictEqual(s.activeSessionId, id);
  assert.strictEqual(s.sessions.length, 1);
});

test('sessions get sequential ids and default names', () => {
  const s = createChatSessions();
  const a = s.newSession();
  const b = s.newSession();
  assert.strictEqual(b, a + 1);
  assert.strictEqual(s.getActive().name, 'Chat 2');
});

test('getActive returns active session; null if none', () => {
  const s = createChatSessions();
  assert.strictEqual(s.getActive(), null);
  s.newSession();
  assert.ok(s.getActive());
});

test('addMessage appends to active session messages', () => {
  const s = createChatSessions();
  const id = s.newSession();
  s.addMessage({ role: 'user', content: 'hi' });
  assert.strictEqual(s.getActive().messages.length, 1);
  assert.strictEqual(s.getActive().messages[0].content, 'hi');
  assert.strictEqual(s.sessions[0].id, id);
});

test('switchSession changes active and returns session', () => {
  const s = createChatSessions();
  const a = s.newSession();
  const b = s.newSession();
  s.addMessage({ role: 'user', content: 'in B' });
  const active = s.switchSession(a);
  assert.strictEqual(s.activeSessionId, a);
  assert.strictEqual(active.id, a);
});

test('switchSession is no-op for unknown or same id', () => {
  const s = createChatSessions();
  const a = s.newSession();
  assert.strictEqual(s.switchSession(999), null);
  assert.strictEqual(s.switchSession(a), null); // same id -> no change
});

test('closeSession removes session and switches active to neighbor', () => {
  const s = createChatSessions();
  const a = s.newSession();
  const b = s.newSession();
  s.closeSession(a);
  assert.deepStrictEqual(s.sessions.map(x => x.id), [b]);
  assert.strictEqual(s.activeSessionId, b);
});

test('closeSession keeps at least one session', () => {
  const s = createChatSessions();
  const a = s.newSession();
  s.closeSession(a);
  assert.strictEqual(s.sessions.length, 1);
});

test('renameSession updates name', () => {
  const s = createChatSessions();
  const a = s.newSession();
  s.renameSession(a, 'Mein Chat');
  assert.strictEqual(s.getActive().name, 'Mein Chat');
});

test('reset clears sessions and resets next id', () => {
  const s = createChatSessions();
  s.newSession();
  s.newSession();
  s.reset();
  assert.deepStrictEqual(s.sessions, []);
  assert.strictEqual(s.nextId, 1);
});
