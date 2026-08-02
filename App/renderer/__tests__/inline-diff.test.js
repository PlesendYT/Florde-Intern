// App/renderer/__tests__/inline-diff.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  createDiffState, pendingHunks, acceptHunk, rejectHunk,
  acceptLine, rejectLine, acceptAll, rejectAll, applyEditsToText
} = require('../inline-diff');

const OLD = 'a\nOLD\nb';
const NEW = 'a\nNEW1\nNEW2\nb';

describe('createDiffState', () => {
  it('keeps original and current text', () => {
    const s = createDiffState('f.js', OLD, NEW);
    assert.strictEqual(s.fileName, 'f.js');
    assert.strictEqual(s.originalText, OLD);
    assert.strictEqual(s.currentText, NEW);
    assert.ok(s.accepted instanceof Set);
  });
});

describe('pendingHunks', () => {
  it('returns all hunks initially', () => {
    const s = createDiffState('f.js', OLD, NEW);
    const h = pendingHunks(s);
    assert.strictEqual(h.length, 1);
    assert.deepStrictEqual(h[0].added.map(x => x.text), ['NEW1', 'NEW2']);
  });
  it('empty after acceptAll', () => {
    const s = createDiffState('f.js', OLD, NEW);
    const s2 = acceptAll(s);
    assert.strictEqual(pendingHunks(s2).length, 0);
  });
});

describe('acceptHunk', () => {
  it('adds added line texts to accepted', () => {
    const s = createDiffState('f.js', OLD, NEW);
    const s2 = acceptHunk(s, 0);
    assert.ok(s2.accepted.has('NEW1'));
    assert.ok(s2.accepted.has('NEW2'));
    assert.strictEqual(pendingHunks(s2).length, 0);
  });
});

describe('acceptLine', () => {
  it('accepts only the given added line', () => {
    const s = createDiffState('f.js', OLD, NEW);
    const s2 = acceptLine(s, 0, 2);
    assert.ok(s2.accepted.has('NEW1'));
    assert.ok(!s2.accepted.has('NEW2'));
    const pending = pendingHunks(s2);
    assert.deepStrictEqual(pending[0].added.map(x => x.text), ['NEW2']);
  });
});

describe('rejectHunk', () => {
  it('replaces added lines with original removed lines', () => {
    const s = createDiffState('f.js', OLD, NEW);
    const { edits } = rejectHunk(s, 0);
    assert.strictEqual(edits.length, 1);
    assert.strictEqual(edits[0].startLine, 2);
    assert.strictEqual(edits[0].endLine, 3);
    assert.deepStrictEqual(edits[0].newLines, ['OLD']);
  });
  it('deletion-only hunk inserts original lines', () => {
    const s = createDiffState('f.js', 'a\nGONE\nb', 'a\nb');
    const { edits } = rejectHunk(s, 0);
    assert.strictEqual(edits.length, 1);
    assert.strictEqual(edits[0].newLines.length, 1);
    assert.strictEqual(edits[0].newLines[0], 'GONE');
  });
});

describe('rejectLine', () => {
  it('removes one added line', () => {
    const s = createDiffState('f.js', OLD, NEW);
    const { edits } = rejectLine(s, 0, 2);
    assert.strictEqual(edits.length, 1);
    assert.strictEqual(edits[0].startLine, 2);
    assert.strictEqual(edits[0].endLine, 2);
    assert.deepStrictEqual(edits[0].newLines, []);
  });
});

describe('applyEditsToText', () => {
  it('applies a replacement edit', () => {
    const text = 'a\nNEW1\nNEW2\nb';
    const out = applyEditsToText(text, [{ startLine: 2, endLine: 3, newLines: ['OLD'] }]);
    assert.strictEqual(out, 'a\nOLD\nb');
  });
  it('applies a deletion edit', () => {
    const text = 'a\nNEW1\nNEW2\nb';
    const out = applyEditsToText(text, [{ startLine: 2, endLine: 3, newLines: [] }]);
    assert.strictEqual(out, 'a\nb');
  });
  it('applies insertion edit (startLine > endLine)', () => {
    const text = 'a\nb';
    const out = applyEditsToText(text, [{ startLine: 2, endLine: 1, newLines: ['GONE'] }]);
    assert.strictEqual(out, 'a\nGONE\nb');
  });
});

describe('rejectAll', () => {
  it('restores original text', () => {
    const s = createDiffState('f.js', OLD, NEW);
    const { edits, state } = rejectAll(s);
    assert.strictEqual(applyEditsToText(s.currentText, edits), OLD);
    assert.strictEqual(state.currentText, OLD);
  });
});
