const GitGraph = {
  _data: [],

  async refresh(projectPath) {
    if (!projectPath) return;
    const logResult = await window.electronAPI.gitExec(projectPath, [
      'log', '--all', '--oneline', '--graph', '--decorate',
      '--format=%H|%P|%s|%an|%at|%D'
    ]);
    const output = logResult.stdout || '';
    if (!output.trim()) {
      this._data = [];
      this._render();
      return;
    }
    this._data = this._parseLog(output);
    this._render();
  },

  _parseLog(output) {
    const lines = output.split('\n').filter(l => l.trim());
    return lines.map(line => {
      const parts = line.split('|');
      return {
        graph: (parts[0] || '').replace(/[^|*\-\/\\]/g, ''),
        hash: (parts[1] || '').trim(),
        parents: (parts[2] || '').split(' ').filter(Boolean),
        message: (parts[3] || '').trim(),
        author: (parts[4] || '').trim(),
        time: parts[5] ? parseInt(parts[5]) * 1000 : 0,
        refs: (parts[6] || '').trim()
      };
    });
  },

  _render() {
    const container = document.getElementById('git-graph');
    const canvas = document.getElementById('git-graph-canvas');
    if (!canvas || !container) return;

    if (!this._data.length) {
      container.classList.add('hidden');
      return;
    }
    container.classList.remove('hidden');

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const rowH = 24;
    const totalH = Math.max(rect.height, this._data.length * rowH + 16);

    canvas.width = rect.width * dpr;
    canvas.height = totalH * dpr;
    canvas.style.height = totalH + 'px';
    ctx.scale(dpr, dpr);

    const w = rect.width;
    ctx.clearRect(0, 0, w, totalH);

    const colors = ['#7c3aed', '#3b82f6', '#22c55e', '#ef4444', '#f59e0b', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4'];
    const branchColorMap = {};
    let nextColorIdx = 0;

    this._data.forEach((commit, i) => {
      const y = i * rowH + 16;
      const graphLen = commit.graph.length;
      const lane = Math.min(graphLen, 8);
      const x = 20 + lane * 16;

      // Determine branch color
      const branchKey = commit.refs || ('col-' + lane);
      if (!branchColorMap[branchKey]) {
        branchColorMap[branchKey] = colors[nextColorIdx % colors.length];
        nextColorIdx++;
      }
      const col = branchColorMap[branchKey];

      // Draw vertical line
      if (i > 0) {
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y - rowH);
        ctx.lineTo(x, y);
        ctx.stroke();
      }

      // Draw merge lines for graph chars
      const graphStr = commit.graph;
      for (let c = 0; c < graphStr.length; c++) {
        if (graphStr[c] === '/' || graphStr[c] === '\\') {
          const parentX = 20 + c * 16;
          ctx.strokeStyle = colors[c % colors.length];
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(parentX, y - rowH);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
      }

      // Draw commit dot
      const isMerge = commit.parents.length > 1;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, isMerge ? 5 : 4, 0, Math.PI * 2);
      ctx.fill();
      if (isMerge) {
        ctx.strokeStyle = '#0a0a0f';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Draw commit info
      const shortHash = commit.hash.substring(0, 7);
      ctx.fillStyle = '#aaa';
      ctx.font = '12px monospace';
      const textX = x + 12;
      const msgText = shortHash + ' ' + commit.message;
      ctx.fillText(msgText, textX, y + 4);

      // Draw refs (branches/tags)
      if (commit.refs) {
        const refText = commit.refs.replace(/[\(\)]/g, '').trim();
        if (refText) {
          const textW = ctx.measureText(msgText).width;
          ctx.fillStyle = '#f59e0b';
          ctx.font = '10px sans-serif';
          ctx.fillText(refText, textX + textW + 8, y + 4);
        }
      }
    });
  }
};
