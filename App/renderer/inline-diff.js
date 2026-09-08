// App/renderer/inline-diff.js
var src = (typeof require === 'function' && require.resolve && require('./diff-utils')) || (typeof window !== 'undefined' ? window : globalThis) || {};
var splitLines = src.splitLines;
var computeHunks = src.computeHunks;

function createDiffState(fileName, originalText, newText) {
  return { fileName, originalText, currentText: newText, accepted: new Set() };
}

function _lineKey(hunkId, x) {
  // Security (b-39): key by hunk+line, never by text — identical duplicate
  // lines otherwise collide (accepting one accepts all copies).
  return hunkId + ':' + x.line + ':' + x.text.length;
}

function pendingHunks(state) {
  const hunks = computeHunks(state.originalText, state.currentText);
  const out = [];
  for (const h of hunks) {
    const added = h.added.filter(x => !state.accepted.has(_lineKey(h.id, x)));
    if (added.length === 0) continue;
    out.push({ ...h, added });
  }
  return out;
}

function _addedTexts(state) {
  return computeHunks(state.originalText, state.currentText)
    .flatMap(h => h.added.map(x => x.text));
}

function _clone(state) {
  return { ...state, accepted: new Set(state.accepted) };
}

function acceptHunk(state, hunkId) {
  const s = _clone(state);
  const hunk = computeHunks(s.originalText, s.currentText).find(h => h.id === hunkId);
  if (!hunk) return s;
  hunk.added.forEach(x => s.accepted.add(_lineKey(hunk.id, x)));
  return s;
}

function acceptLine(state, hunkId, lineNo) {
  const s = _clone(state);
  const hunk = computeHunks(s.originalText, s.currentText).find(h => h.id === hunkId);
  if (!hunk) return s;
  const line = hunk.added.find(x => x.line === lineNo);
  if (line) s.accepted.add(_lineKey(hunk.id, line));
  return s;
}

function acceptAll(state) {
  const s = _clone(state);
  computeHunks(s.originalText, s.currentText)
    .forEach(h => h.added.forEach(x => s.accepted.add(_lineKey(h.id, x))));
  return s;
}

function rejectHunk(state, hunkId) {
  const hunk = computeHunks(state.originalText, state.currentText).find(h => h.id === hunkId);
  if (!hunk) return { edits: [], state };
  const originalLines = hunk.removed.map(x => x.text);
  let edits;
  if (hunk.added.length > 0) {
    edits = [{ startLine: hunk.startLine, endLine: hunk.endLine, newLines: originalLines }];
  } else {
    edits = [{ startLine: hunk.startLine, endLine: hunk.startLine - 1, newLines: originalLines }];
  }
  const next = _clone(state);
  next.currentText = applyEditsToText(next.currentText, edits);
  return { edits, state: next };
}

function rejectLine(state, hunkId, lineNo) {
  const hunk = computeHunks(state.originalText, state.currentText).find(h => h.id === hunkId);
  if (!hunk) return { edits: [], state };
  const line = hunk.added.find(x => x.line === lineNo);
  if (!line) return { edits: [], state };
  const edits = [{ startLine: line.line, endLine: line.line, newLines: [] }];
  const next = _clone(state);
  next.currentText = applyEditsToText(next.currentText, edits);
  return { edits, state: next };
}

function rejectAll(state) {
  const edits = [{ startLine: 1, endLine: splitLines(state.currentText).length, newLines: splitLines(state.originalText) }];
  const next = _clone(state);
  next.currentText = state.originalText;
  return { edits, state: next };
}

function applyEditsToText(text, edits) {
  let lines = splitLines(text);
  const sorted = [...edits].sort((a, b) => b.startLine - a.startLine);
  for (const e of sorted) {
    const start = e.startLine - 1;
    const end = e.endLine - 1;
    if (start > end) {
      lines.splice(start, 0, ...e.newLines);
    } else {
      lines.splice(start, end - start + 1, ...e.newLines);
    }
  }
  return lines.join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createDiffState, pendingHunks, acceptHunk, rejectHunk,
    acceptLine, rejectLine, acceptAll, rejectAll, applyEditsToText
  };
}
