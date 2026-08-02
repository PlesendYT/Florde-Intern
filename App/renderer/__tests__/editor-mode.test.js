// App/renderer/__tests__/editor-mode.test.js
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { EditorMode } = require('../editor-mode');

function mockStore() {
  const data = {};
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    _data: data
  };
}

beforeEach(() => {
  EditorMode._store = mockStore();
  EditorMode._mode = null;
  EditorMode.onModeChange = null;
});

describe('EditorMode.setMode', () => {
  it('defaults to editor when no stored mode', () => {
    assert.strictEqual(EditorMode.getMode(), 'editor');
  });
  it('persists chat mode', () => {
    EditorMode.setMode('chat');
    assert.strictEqual(EditorMode.getMode(), 'chat');
    assert.strictEqual(EditorMode._store.getItem('florde-app-mode'), 'chat');
  });
  it('persists editor mode', () => {
    EditorMode.setMode('chat');
    EditorMode.setMode('editor');
    assert.strictEqual(EditorMode.getMode(), 'editor');
  });
  it('rejects invalid mode', () => {
    EditorMode.setMode('bogus');
    assert.strictEqual(EditorMode.getMode(), 'editor');
  });
  it('fires onModeChange callback', () => {
    let fired = null;
    EditorMode.onModeChange = (m) => { fired = m; };
    EditorMode.setMode('chat');
    assert.strictEqual(fired, 'chat');
  });
  it('reads stored mode on first getMode', () => {
    EditorMode._store.setItem('florde-app-mode', 'chat');
    assert.strictEqual(EditorMode.getMode(), 'chat');
  });
});

describe('EditorMode._buildPrompt', () => {
  const sel = 'const x = 1;';
  const ctx = { text: sel, lang: 'javascript', fileName: 'app.js', goal: 'besser' };

  it('builds explain prompt with code fence', () => {
    const p = EditorMode._buildPrompt('explain', ctx);
    assert.ok(p.includes('app.js'));
    assert.ok(p.includes('```javascript\n' + sel + '\n```'));
  });
  it('builds whatis prompt', () => {
    const p = EditorMode._buildPrompt('whatis', ctx);
    assert.ok(p.toLowerCase().includes('was ist das'));
    assert.ok(p.includes(sel));
  });
  it('builds improve prompt with goal', () => {
    const p = EditorMode._buildPrompt('improve', ctx);
    assert.ok(p.includes('besser'));
    assert.ok(p.includes(sel));
  });
  it('builds change prompt with free instruction', () => {
    const p = EditorMode._buildPrompt('change', { ...ctx, goal: 'Mach es async' });
    assert.ok(p.includes('Mach es async'));
  });
  it('builds refactor prompt', () => {
    const p = EditorMode._buildPrompt('refactor', ctx);
    assert.ok(p.toLowerCase().includes('refactor'));
  });
  it('includes file context header', () => {
    const p = EditorMode._buildPrompt('explain', ctx);
    assert.ok(p.includes('Datei: app.js'));
  });
});
