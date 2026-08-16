// App/renderer/__tests__/smart-search.test.js
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { SmartSearch, createDebouncer } = require('../smart-search');

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

describe('createDebouncer', () => {
  it('fires only once after rapid calls', async () => {
    let count = 0;
    const debounced = createDebouncer(20, () => count++);
    debounced(); debounced(); debounced();
    await wait(50);
    assert.strictEqual(count, 1);
  });
  it('passes last argument', async () => {
    let last = null;
    const debounced = createDebouncer(20, (x) => { last = x; });
    debounced(1); debounced(2); debounced(3);
    await wait(50);
    assert.strictEqual(last, 3);
  });
});

describe('SmartSearch._filter', () => {
  const results = {
    file: [{ name: 'LoginButton.jsx', path: 'src/LoginButton.jsx' }],
    symbol: [{ name: 'LoginButton', kind: 'class', file: 'src/LoginButton.jsx', line: 10 }],
    todo: [{ text: 'Fix login validation', done: 0 }],
    commit: [{ message: 'fix login button styles', shortHash: 'a1b2c3' }]
  };

  it('filters each category by query', () => {
    const f = SmartSearch._filter(results, 'login');
    assert.ok(f.file.length === 1);
    assert.ok(f.symbol.length === 1);
    assert.ok(f.todo.length === 1);
    assert.ok(f.commit.length === 1);
  });
  it('drops empty categories', () => {
    const f = SmartSearch._filter(results, 'xyz');
    assert.ok(!f.file || f.file.length === 0);
  });
  it('matches symbol by name', () => {
    const f = SmartSearch._filter(results, 'LoginButton');
    assert.ok(f.symbol.length === 1);
  });
});

describe('SmartSearch._navigate', () => {
  it('file maps to openTab', () => {
    const n = SmartSearch._navigate({ category: 'file', path: 'src/a.js' });
    assert.strictEqual(n.action, 'openTab');
    assert.strictEqual(n.value, 'src/a.js');
  });
  it('symbol maps to openTabAtLine', () => {
    const n = SmartSearch._navigate({ category: 'symbol', file: 'src/a.js', line: 12 });
    assert.strictEqual(n.action, 'openTabAtLine');
    assert.strictEqual(n.value.path, 'src/a.js');
    assert.strictEqual(n.value.line, 12);
  });
  it('memory maps to openTab', () => {
    const n = SmartSearch._navigate({ category: 'memory', path: '.florde/memory/memory.md' });
    assert.strictEqual(n.action, 'openTab');
  });
  it('commit maps to openGit', () => {
    const n = SmartSearch._navigate({ category: 'commit', shortHash: 'a1b2c3' });
    assert.strictEqual(n.action, 'openGit');
    assert.strictEqual(n.value, 'a1b2c3');
  });
  it('todo maps to openPanel todo', () => {
    const n = SmartSearch._navigate({ category: 'todo' });
    assert.strictEqual(n.action, 'openPanel');
    assert.strictEqual(n.value, 'todo');
  });
  it('decision maps to openPanel decisions', () => {
    const n = SmartSearch._navigate({ category: 'decision' });
    assert.strictEqual(n.action, 'openPanel');
    assert.strictEqual(n.value, 'decisions');
  });
  it('issue maps to openUrl', () => {
    const n = SmartSearch._navigate({ category: 'issue', url: 'https://github.com/x/y/issues/1' });
    assert.strictEqual(n.action, 'openUrl');
    assert.strictEqual(n.value, 'https://github.com/x/y/issues/1');
  });
  it('unknown category maps to none', () => {
    const n = SmartSearch._navigate({ category: 'bogus' });
    assert.strictEqual(n.action, 'none');
  });
});

describe('SmartSearch._search with injected sources', () => {
  beforeEach(() => {
    SmartSearch.setSources({
      file: async (q) => [{ name: q + '.js', path: q + '.js' }],
      symbol: async (q) => [{ name: q, kind: 'class', file: q + '.js', line: 1 }],
      commit: async (q) => [{ message: q, shortHash: 'x' }],
      memory: null, issue: null, todo: null, decision: null
    });
  });

  it('aggregates all non-null sources', async () => {
    const out = await SmartSearch._search('Login');
    assert.strictEqual(out.file.length, 1);
    assert.strictEqual(out.symbol.length, 1);
    assert.strictEqual(out.commit.length, 1);
    assert.strictEqual(out.memory, null);
    assert.strictEqual(out.issue, null);
  });
  it('never rejects when a source throws', async () => {
    SmartSearch.setSources({ file: async () => { throw new Error('boom'); }, commit: async (q) => [q] });
    const out = await SmartSearch._search('x');
    assert.deepStrictEqual(out.file, []);
    assert.ok(out.commit.length === 1);
  });
  it('empty query returns all null categories', async () => {
    const out = await SmartSearch._search('');
    assert.strictEqual(out.file, null);
  });
});
