const TimeTracking = {
  _startTime: null,
  _timer: null,
  _elapsed: 0,
  _data: null,
  _dataPath: null,

  async init() {
    this._dataPath = (await window.electronAPI.getSandboxDir()) + '/time-tracking.json';
    await this._load();
    const sessions = this._data.sessions || [];
    const last = sessions[sessions.length - 1];
    if (last && !last.end) {
      this._startTime = new Date(last.start);
      this._startTimer();
    }
    this._render();
    setInterval(() => this._save(), 30000);
    window.addEventListener('beforeunload', () => this._save());
  },

  _load() {
    try {
      const raw = localStorage.getItem('florde-time-tracking');
      this._data = raw ? JSON.parse(raw) : { sessions: [] };
    } catch { this._data = { sessions: [] }; }
  },

  _save() {
    localStorage.setItem('florde-time-tracking', JSON.stringify(this._data));
  },

  toggle() {
    if (this._startTime) {
      this._stopTimer();
    } else {
      this._startTimer();
    }
    this._render();
  },

  _startTimer() {
    if (!this._startTime) this._startTime = new Date();
    this._timer = setInterval(() => { this._render(); }, 1000);
  },

  _stopTimer() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this._startTime) {
      const end = new Date();
      this._data.sessions.push({ start: this._startTime.toISOString(), end: end.toISOString() });
      this._startTime = null;
      this._save();
    }
    this._render();
  },

  _getTodayMs() {
    const today = new Date().toDateString();
    let total = 0;
    for (const s of (this._data.sessions || [])) {
      if (new Date(s.start).toDateString() === today) {
        total += new Date(s.end || Date.now()) - new Date(s.start);
      }
    }
    if (this._startTime) {
      total += Date.now() - this._startTime.getTime();
    }
    return total;
  },

  _format(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return (h > 0 ? h + 'h ' : '') + (m > 0 ? m + 'm ' : '') + s + 's';
  },

  _render() {
    let el = document.getElementById('time-tracker');
    if (!el) {
      el = document.createElement('span');
      el.id = 'time-tracker';
      el.style.cssText = 'cursor:pointer;font-size:0.8rem;color:var(--text3);margin-left:0.5rem;user-select:none;';
      el.title = 'Click to start/stop timer';
      const ref = document.getElementById('project-name');
      if (ref && ref.parentNode) ref.parentNode.insertBefore(el, ref.nextSibling);
    }
    const running = this._startTime !== null;
    el.textContent = (running ? '▶ ' : '⏸ ') + this._format(this._getTodayMs());
    el.style.color = running ? 'var(--accent)' : 'var(--text3)';
    el.onclick = () => this.toggle();
  }
};
