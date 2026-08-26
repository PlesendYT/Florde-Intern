// App/renderer/__tests__/diff-utils.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { splitLines, computeHunks } = require('../diff-utils');

describe('splitLines', () => {
  it('splits on newline', () => {
    assert.deepStrictEqual(splitLines('a\nb\nc'), ['a', 'b', 'c']);
  });
  it('empty string gives empty array', () => {
    assert.deepStrictEqual(splitLines(''), ['']);
  });
  it('null gives empty array', () => {
    assert.deepStrictEqual(splitLines(null), ['']);
  });
});

describe('computeHunks', () => {
  it('no changes gives no hunks', () => {
    assert.deepStrictEqual(computeHunks('a\nb\nc', 'a\nb\nc'), []);
  });

  it('pure insertion yields one hunk with added line', () => {
    const hunks = computeHunks('a\nb', 'a\nNEW\nb');
    assert.strictEqual(hunks.length, 1);
    assert.strictEqual(hunks[0].startLine, 2);
    assert.strictEqual(hunks[0].endLine, 2);
    assert.deepStrictEqual(hunks[0].added, [{ line: 2, text: 'NEW' }]);
    assert.deepStrictEqual(hunks[0].removed, []);
  });

  it('pure deletion yields one hunk with removed line', () => {
    const hunks = computeHunks('a\nGONE\nb', 'a\nb');
    assert.strictEqual(hunks.length, 1);
    assert.deepStrictEqual(hunks[0].removed, [{ line: 2, text: 'GONE' }]);
    assert.deepStrictEqual(hunks[0].added, []);
  });

  it('replacement yields hunk with both added and removed', () => {
    const hunks = computeHunks('a\nOLD\nb', 'a\nNEW\nb');
    assert.strictEqual(hunks.length, 1);
    assert.deepStrictEqual(hunks[0].added, [{ line: 2, text: 'NEW' }]);
    assert.deepStrictEqual(hunks[0].removed, [{ line: 2, text: 'OLD' }]);
  });

  it('multiple separated changes yield multiple hunks', () => {
    const hunks = computeHunks('a\nb\nc\nd', 'a\nX\nc\nY');
    assert.strictEqual(hunks.length, 2);
    assert.strictEqual(hunks[0].added[0].line, 2);
    assert.strictEqual(hunks[1].added[0].line, 4);
  });

  it('multi-line insertion at end', () => {
    const hunks = computeHunks('a\nb', 'a\nb\nL1\nL2');
    assert.strictEqual(hunks.length, 1);
    assert.deepStrictEqual(hunks[0].added.map(x => x.text), ['L1', 'L2']);
    assert.strictEqual(hunks[0].startLine, 3);
    assert.strictEqual(hunks[0].endLine, 4);
  });

  it('pure deletion at end yields one hunk', () => {
    const hunks = computeHunks('a\nb\nGONE', 'a\nb');
    assert.strictEqual(hunks.length, 1);
    assert.deepStrictEqual(hunks[0].removed, [{ line: 3, text: 'GONE' }]);
  });
});
