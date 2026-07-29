const TimeTracking = {
  _currentProject: null,
  _startTime: null,
  _timer: null,
  _useLocalStorage: false,

  async init() {
    await this._ensureTable();
    this._render();
    setInterval(() => this._autoSave(), 30000);
    window.addEventListener('beforeunload', () => this.stop());
  },

  async _ensureTable() {
    const sql = `CREATE TABLE IF NOT EXISTS time_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL,
      start TIMESTAMP NOT NULL,
      end TIMESTAMP
    )`;
    try {
      await window.electronAPI.flordeDb.run('florde', sql);
    } catch (e) {
      this._useLocalStorage = true;
    }
  },

  start(project) {
    if (this._currentProject === project && this._startTime) return;
    this.stop();
    this._currentProject = project;
    this._startTime = new Date();
    this._timer = setInterval(() => this._render(), 1000);
    this._render();
  },

  stop() {
    if (this._startTime && this._currentProject) {
      const end = new Date();
      const start = this._startTime.toISOString();
      const project = this._currentProject;
      // Synchronous localStorage save (works during beforeunload, no IPC)
      const data = JSON.parse(localStorage.getItem('florde-time-tracking') || '{"sessions":[]}');
      data.sessions.push({ project, start, end: end.toISOString() });
      localStorage.setItem('florde-time-tracking', JSON.stringify(data));
    }
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this._startTime = null;
    this._currentProject = null;
  },

  pause() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this._render();
  },

  resume() {
    if (this._startTime && !this._timer) {
      this._timer = setInterval(() => this._render(), 1000);
    }
    this._render();
  },

  async _saveSession(project, start, end) {
    // Always save to localStorage (shared store across all projects)
    const data = JSON.parse(localStorage.getItem('florde-time-tracking') || '{"sessions":[]}');
    data.sessions.push({ project, start, end });
    localStorage.setItem('florde-time-tracking', JSON.stringify(data));
    // Best-effort per-project DB save
    try {
      await window.electronAPI.flordeDb.run(project || 'florde',
        `INSERT INTO time_sessions (project, start, end) VALUES (?, ?, ?)`,
        [project, start, end]);
    } catch { /* DB save is best-effort */ }
  },

  async _autoSave() {
    if (this._startTime && this._currentProject) {
      const now = new Date();
      const seconds = Math.round((now - this._startTime) / 1000);
      if (seconds >= 30) {
        await this._saveSession(this._currentProject, this._startTime.toISOString(), now.toISOString());
        this._startTime = now;
      }
    }
  },

  async _getSessions(project) {
    // Always read from localStorage (contains all projects' sessions)
    const data = JSON.parse(localStorage.getItem('florde-time-tracking') || '{"sessions":[]}');
    let rows = data.sessions;
    if (project) rows = rows.filter(s => s.project === project);
    return rows;
  },

  async getStats(filterProject) {
    const sessions = await this._getSessions(filterProject);
    const now = new Date();
    const today = now.toDateString();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
    weekStart.setHours(0, 0, 0, 0);

    let todayMs = 0, weekMs = 0, totalMs = 0;
    for (const s of sessions) {
      const start = new Date(s.start);
      const end = s.end ? new Date(s.end) : now;
      const ms = end - start;
      if (ms <= 0) continue;
      totalMs += ms;
      if (start.toDateString() === today) todayMs += ms;
      if (start >= weekStart) weekMs += ms;
    }
    if (!filterProject && this._startTime) {
      const running = now - this._startTime;
      todayMs += running; weekMs += running; totalMs += running;
    }
    return {
      today: this._format(todayMs),
      week: this._format(weekMs),
      total: this._format(totalMs),
      todayMs, weekMs, totalMs,
      running: this._startTime !== null,
      currentProject: this._currentProject
    };
  },

  async getAllProjectsStats() {
    const sessions = await this._getSessions(null);
    const now = new Date();
    const today = now.toDateString();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
    weekStart.setHours(0, 0, 0, 0);

    const projects = {};
    for (const s of sessions) {
      const proj = s.project || 'unknown';
      if (!projects[proj]) projects[proj] = { todayMs: 0, weekMs: 0, totalMs: 0 };
      const start = new Date(s.start);
      const end = s.end ? new Date(s.end) : now;
      const ms = end - start;
      if (ms <= 0) continue;
      projects[proj].totalMs += ms;
      if (start.toDateString() === today) projects[proj].todayMs += ms;
      if (start >= weekStart) projects[proj].weekMs += ms;
    }
    if (this._startTime && this._currentProject) {
      const running = now - this._startTime;
      if (!projects[this._currentProject]) projects[this._currentProject] = { todayMs: 0, weekMs: 0, totalMs: 0 };
      projects[this._currentProject].todayMs += running;
      projects[this._currentProject].weekMs += running;
      projects[this._currentProject].totalMs += running;
    }
    return projects;
  },

  async renderDashboard(container) {
    const stats = await this.getStats(null);
    const allProjects = await this.getAllProjectsStats();
    let html = `<div class="time-dashboard"><div class="time-dash-header">⏱ Time Tracking</div>`;
    if (stats.running) {
      html += `<div class="time-dash-current">▶ ${stats.currentProject} — ${this._format(stats.todayMs)} today</div>`;
    } else {
      html += `<div class="time-dash-current paused">⏸ Paused</div>`;
    }
    html += `<table class="time-dash-table"><tr><th>Project</th><th>Today</th><th>Week</th><th>Total</th></tr>`;
    let grandToday = 0, grandWeek = 0, grandTotal = 0;
    for (const [proj, p] of Object.entries(allProjects)) {
      html += `<tr><td>${escapeHtml(proj)}</td><td>${this._format(p.todayMs)}</td><td>${this._format(p.weekMs)}</td><td>${this._format(p.totalMs)}</td></tr>`;
      grandToday += p.todayMs; grandWeek += p.weekMs; grandTotal += p.totalMs;
    }
    html += `<tr class="time-dash-total"><td><strong>Total</strong></td><td><strong>${this._format(grandToday)}</strong></td><td><strong>${this._format(grandWeek)}</strong></td><td><strong>${this._format(grandTotal)}</strong></td></tr>`;
    html += `</table></div>`;
    container.innerHTML = html;
  },

  _format(ms) {
    if (ms <= 0) return '0m';
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    let parts = [];
    if (days > 0) parts.push(days + 'd');
    if (hours > 0) parts.push(hours + 'h');
    if (mins > 0 || parts.length === 0) parts.push(mins + 'm');
    return parts.join(' ');
  },

  _render() {
    // Internal only — no visible timer element in the UI.
    // The _timer interval keeps running so auto-save triggers.
  }
};
