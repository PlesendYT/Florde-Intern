// App/renderer/diff-utils.js
function splitLines(text) {
  return (text == null ? '' : text).split('\n');
}

function lcsDiff(aLines, bLines) {
  const n = aLines.length, m = bLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (aLines[i] === bLines[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) { ops.push({ type: 'same' }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: 'del', text: aLines[i] }); i++; }
    else { ops.push({ type: 'add', text: bLines[j] }); j++; }
  }
  while (i < n) { ops.push({ type: 'del', text: aLines[i] }); i++; }
  while (j < m) { ops.push({ type: 'add', text: bLines[j] }); j++; }
  return ops;
}

function computeHunks(oldText, newText) {
  const aLines = splitLines(oldText);
  const bLines = splitLines(newText);
  const ops = lcsDiff(aLines, bLines);
  const hunks = [];
  let aIdx = 1, bIdx = 1;
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op.type === 'same') { aIdx++; bIdx++; continue; }
    let start = bIdx, end = bIdx - 1, added = [], removed = [];
    while (k < ops.length && ops[k].type !== 'same') {
      const cur = ops[k];
      if (cur.type === 'add') { added.push({ line: bIdx, text: cur.text }); end = bIdx; bIdx++; }
      else { removed.push({ line: aIdx, text: cur.text }); aIdx++; }
      k++;
    }
    k--;
    hunks.push({ id: hunks.length, startLine: start, endLine: end, added, removed });
  }
  return hunks;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { splitLines, computeHunks, lcsDiff };
}
