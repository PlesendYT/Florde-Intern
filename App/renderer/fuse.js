const Fuse = class {
  constructor(list, opts) {
    this._list = list;
    this._keys = opts.keys || [];
    this._threshold = opts.threshold !== undefined ? opts.threshold : 0.6;
  }

  search(query) {
    if (!query) return this._list.map(item => ({ item }));
    const q = query.toLowerCase();
    const results = [];
    for (const item of this._list) {
      let bestScore = Infinity;
      for (const key of this._keys) {
        const val = String(item[key] || '').toLowerCase();
        const score = this._score(q, val);
        if (score < bestScore) bestScore = score;
      }
      if (bestScore <= this._threshold) {
        results.push({ item, score: bestScore });
      }
    }
    results.sort((a, b) => a.score - b.score);
    return results;
  }

  _score(pattern, text) {
    if (text === pattern) return 0;
    if (text.includes(pattern)) {
      const idx = text.indexOf(pattern);
      return 0.1 + idx * 0.001;
    }
    let pi = 0;
    let ti = 0;
    let score = 0;
    let prevMatchIdx = -1;
    let consecutive = 0;
    while (pi < pattern.length && ti < text.length) {
      if (pattern[pi] === text[ti]) {
        score += consecutive * 0.05;
        if (prevMatchIdx >= 0) {
          const gap = ti - prevMatchIdx - 1;
          score += gap * 0.02;
        }
        if (ti === 0 || text[ti - 1] === '/' || text[ti - 1] === '_' || text[ti - 1] === '-' || text[ti - 1] === '.' || text[ti - 1] === ' ') {
          score -= 0.1;
        }
        prevMatchIdx = ti;
        pi++;
        consecutive++;
      } else {
        consecutive = 0;
        ti++;
      }
    }
    if (pi < pattern.length) return 1;
    return Math.min(score, 1);
  }
};
