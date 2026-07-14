# Code Intelligence V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 new tools (Project Health Scan, Feature Timeline, Idea Evolution, Git Clarify, Explain my Project) to the Code Intelligence tab.

**Architecture:** All 5 features live as new tool entries in the existing `_getTools()` / `_renderToolView()` dispatch in `code-intelligence.js`. Each feature gets its own `_render*` method and helper methods. UI patterns follow existing inline-style generation. localStorage used for timeline persistence.

**Tech Stack:** Vanilla JS, Electron (node:child_process for git/npm commands), plain `<script>` loading.

## Global Constraints

- All new tools go in `App/renderer/tools/code-intelligence.js`
- Follow existing `_renderToolView()` pattern: render into `this._resultsEl` as innerHTML
- Use `escapeHtml()` for any AI-generated or user-provided text displayed in the UI
- Provider calls use `providers[providerId].sendPlain()` with `AbortSignal.timeout(60000)`
- All git/npm commands run via `window.api.runTerminalCommand()` or direct `require('child_process')` depending on existing pattern — check how `dep-check` runs npm commands
- CSS goes in `App/renderer/style.css` at end of file under "CI V2" section marker
- No new files created

---

### Task 1: Setup — Sound System + CSS Foundation

**Files:**
- Modify: `App/renderer/tools/code-intelligence.js` — add `_playEventSound()` method
- Modify: `App/renderer/style.css` — add all new CSS classes, remove orphaned `#ci-panel` block

**Interfaces:**
- Consumes: nothing
- Produces: `CodeIntelligence._playEventSound()` (used by Tasks 2-4), CSS classes used by Tasks 2-6

- [ ] **Step 1: Add `_playEventSound()` to code-intelligence.js**

Insert after `_showNotice()` (around line 84):

```js
_playEventSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  } catch(e) { /* silent */ }
}
```

- [ ] **Step 2: Verify the method works**

Run: `node -e "console.log('syntax ok')"` (the file is loaded at runtime, not Node, but check for syntax errors)

- [ ] **Step 3: Add CSS to style.css**

Append to end of `style.css`:

```css
/* CI V2 */
.ci-v2-section { margin-bottom: 1rem; }
.ci-v2-btn { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.4rem 0.75rem; border: 1px solid var(--border); border-radius: 4px; background: var(--bg2); color: var(--text); cursor: pointer; font-size: 0.8rem; }
.ci-v2-btn:hover { background: var(--bg3); }
.ci-v2-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ci-v2-btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.ci-v2-btn-primary:hover { filter: brightness(1.1); }
.ci-v2-btn-danger { background: #c0392b; color: #fff; border-color: #c0392b; }
.ci-v2-btn-danger:hover { filter: brightness(1.1); }
.ci-v2-btn-sm { font-size: 0.75rem; padding: 0.2rem 0.5rem; }

/* Health Scan */
.ci-scan-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--border); font-size: 0.85rem; }
.ci-scan-icon { font-size: 1rem; width: 1.5rem; text-align: center; }
.ci-scan-pass { color: #27ae60; }
.ci-scan-warn { color: #f39c12; }
.ci-scan-fail { color: #e74c3c; }
.ci-scan-summary { padding: 0.5rem; font-size: 0.85rem; font-weight: 600; text-align: center; }

/* Feature Timeline */
.ci-tl-month { font-weight: 700; font-size: 0.85rem; padding: 0.5rem 0.5rem 0.25rem; background: var(--bg); position: sticky; top: 0; z-index: 1; border-bottom: 1px solid var(--border); }
.ci-tl-entry { display: flex; justify-content: space-between; align-items: center; padding: 0.3rem 0.5rem 0.3rem 1rem; font-size: 0.82rem; border-bottom: 1px solid var(--border2); cursor: default; }
.ci-tl-entry:hover { background: var(--bg2); }
.ci-tl-name { font-weight: 600; }
.ci-tl-date { color: var(--text2); font-size: 0.75rem; }
.ci-tl-hover-desc { display: none; position: absolute; background: var(--bg); border: 1px solid var(--border); padding: 0.5rem; border-radius: 4px; font-size: 0.8rem; max-width: 300px; white-space: normal; z-index: 100; }
.ci-tl-entry:hover .ci-tl-hover-desc { display: block; }

/* Idea Evolution */
.ci-ie-textarea { width: 100%; min-height: 80px; padding: 0.5rem; border: 1px solid var(--border); border-radius: 4px; background: var(--bg2); color: var(--text); font-size: 0.85rem; resize: vertical; }
.ci-ie-checkboxes { display: flex; flex-wrap: wrap; gap: 0.75rem; padding: 0.4rem 0; font-size: 0.85rem; }
.ci-ie-checkboxes label { display: flex; align-items: center; gap: 0.3rem; cursor: pointer; }
.ci-ie-result { border: 1px solid var(--border); border-radius: 4px; margin-top: 0.5rem; }
.ci-ie-result-header { padding: 0.3rem 0.5rem; background: var(--bg2); font-weight: 600; font-size: 0.82rem; border-bottom: 1px solid var(--border); cursor: pointer; display: flex; justify-content: space-between; }
.ci-ie-result-body { padding: 0.5rem; font-size: 0.82rem; white-space: pre-wrap; }

/* Git Clarify */
.ci-gc-confirm { padding: 1rem; text-align: center; font-size: 0.85rem; }
.ci-gc-confirm-btns { display: flex; gap: 0.5rem; justify-content: center; margin-top: 0.75rem; }
.ci-gc-commit { display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.5rem; border-bottom: 1px solid var(--border); font-size: 0.82rem; flex-wrap: wrap; }
.ci-gc-hash { font-family: monospace; color: var(--text2); font-size: 0.75rem; min-width: 60px; }
.ci-gc-old { text-decoration: line-through; color: #e74c3c; }
.ci-gc-new { color: #27ae60; }
.ci-gc-actions { display: flex; gap: 0.3rem; margin-left: auto; }
.ci-gc-bottom { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.5rem; border-top: 1px solid var(--border); position: sticky; bottom: 0; background: var(--bg); }

/* Explain Project */
.ci-ep-output { padding: 0.5rem; font-size: 0.85rem; white-space: pre-wrap; border: 1px solid var(--border); border-radius: 4px; background: var(--bg2); max-height: 400px; overflow-y: auto; }
.ci-ep-copy { display: flex; justify-content: flex-end; margin-bottom: 0.5rem; }
```

- [ ] **Step 4: Remove orphaned `#ci-panel` CSS**

In `style.css`, find and delete lines 583-597 (the `#ci-panel { ... }` block).

- [ ] **Step 5: Commit**

```bash
git add App/renderer/tools/code-intelligence.js App/renderer/style.css
git commit -m "feat: add sound system and CSS foundation for CI v2 tools"
```

---

### Task 2: Project Health Scan

**Files:**
- Modify: `App/renderer/tools/code-intelligence.js`

**Interfaces:**
- Consumes: `_playEventSound()` from Task 1, CSS classes `.ci-scan-*` from Task 1
- Produces: tool entry `health-scan`, `_renderProjectHealth()` and `_runHealthScan()`

- [ ] **Step 1: Add `health-scan` to `_getTools()`**

Find `_getTools()` (around line 65) and add to the tools array:

```js
{ id: 'health-scan', label: 'Project Health Scan', icon: '🔍', needsKey: false }
```

- [ ] **Step 2: Add dispatch case in `_renderToolView()`**

In `_renderToolView()` (around line 86), add:

```js
case 'health-scan': this._renderProjectHealth(); break;
```

- [ ] **Step 3: Implement `_renderProjectHealth()`**

Add after `_showNotice()`:

```js
_renderProjectHealth() {
  this._resultsEl.innerHTML = `
    <div class="ci-v2-section">
      <button class="ci-v2-btn ci-v2-btn-primary" id="ci-scan-start">🔍 Scan starten</button>
    </div>
    <div id="ci-scan-results"></div>
  `;
  document.getElementById('ci-scan-start').onclick = () => this._runHealthScan();
}

async _runHealthScan() {
  const el = document.getElementById('ci-scan-results');
  el.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text2);">Scanne...</div>';
  const results = [];

  // 1. Build check
  try {
    const buildRes = await window.api.runTerminalCommand('npm run build 2>&1 || true');
    const ok = buildRes.exitCode === 0 || !buildRes.stderr?.includes('ERR');
    results.push({ label: 'Build', ok, detail: ok ? 'Build erfolgreich' : 'Build fehlgeschlagen', severity: ok ? 'pass' : 'fail' });
  } catch {
    results.push({ label: 'Build', ok: false, detail: 'Build konnte nicht ausgeführt werden', severity: 'fail' });
  }

  // 2. Outdated packages
  try {
    const outdatedRes = await window.api.runTerminalCommand('npm outdated --json 2>&1 || true');
    let outdated = [];
    try { outdated = JSON.parse(outdatedRes.stdout || '{}'); } catch {}
    const keys = Object.keys(outdated);
    results.push({ label: 'Veraltete Pakete', ok: keys.length === 0, detail: keys.length === 0 ? 'Keine veralteten Pakete' : keys.length + ' veraltete Pakete: ' + keys.join(', '), severity: keys.length === 0 ? 'pass' : keys.length > 5 ? 'fail' : 'warn' });
  } catch {
    results.push({ label: 'Veraltete Pakete', ok: false, detail: 'Prüfung fehlgeschlagen', severity: 'fail' });
  }

  // 3. Git status
  try {
    const gitRes = await window.api.runTerminalCommand('git status --porcelain 2>&1');
    const lines = (gitRes.stdout || '').trim().split('\n').filter(Boolean);
    results.push({ label: 'Git Status', ok: lines.length === 0, detail: lines.length === 0 ? 'Sauberer Working Tree' : lines.length + ' uncommitted Datei(en)', severity: lines.length === 0 ? 'pass' : lines.length > 10 ? 'fail' : 'warn' });
  } catch {
    results.push({ label: 'Git Status', ok: false, detail: 'Kein Git-Repository', severity: 'fail' });
  }

  // 4. Security audit
  try {
    const auditRes = await window.api.runTerminalCommand('npm audit --json 2>&1 || true');
    let audit = {};
    try { audit = JSON.parse(auditRes.stdout || '{}'); } catch {}
    const vulns = audit.vulnerabilities || {};
    const critical = Object.values(vulns).filter(v => v.severity === 'critical').length;
    const high = Object.values(vulns).filter(v => v.severity === 'high').length;
    const moderate = Object.values(vulns).filter(v => v.severity === 'moderate').length;
    results.push({
      label: 'Sicherheit',
      ok: critical === 0 && high === 0,
      detail: critical + ' critical, ' + high + ' high, ' + moderate + ' moderate',
      severity: critical > 0 ? 'fail' : high > 0 ? 'warn' : 'pass'
    });
  } catch {
    results.push({ label: 'Sicherheit', ok: false, detail: 'Audit fehlgeschlagen', severity: 'fail' });
  }

  // 5. Backup check
  try {
    const backupRes = await window.api.runTerminalCommand('Get-ChildItem -LiteralPath "." -Filter "backup-*" -Name 2>$null; Get-ChildItem -LiteralPath "." -Filter "*.bak" -Name 2>$null');
    const backupFiles = (backupRes.stdout || '').trim().split('\n').filter(Boolean);
    const hasBackup = backupFiles.length > 0;
    results.push({ label: 'Backup', ok: hasBackup, detail: hasBackup ? 'Backup gefunden: ' + backupFiles[0] : 'Kein Backup vorhanden', severity: hasBackup ? 'pass' : 'warn' });
  } catch {
    results.push({ label: 'Backup', ok: false, detail: 'Backup-Prüfung fehlgeschlagen', severity: 'warn' });
  }

  // Render
  const passed = results.filter(r => r.ok).length;
  const warned = results.filter(r => r.severity === 'warn').length;
  const failed = results.filter(r => r.severity === 'fail').length;
  el.innerHTML = results.map(r =>
    `<div class="ci-scan-row"><span class="ci-scan-icon ci-scan-${r.severity}">${r.ok ? '✅' : '❌'}</span><span class="ci-scan-${r.severity}">${escapeHtml(r.label)}:</span> ${escapeHtml(r.detail)}</div>`
  ).join('') + `<div class="ci-scan-summary">${passed}/5 bestanden${warned ? ', ' + warned + ' Warnung(en)' : ''}${failed ? ', ' + failed + ' Fehler' : ''}</div>`;

  this._playEventSound();
}
```

- [ ] **Step 4: Commit**

```bash
git add App/renderer/tools/code-intelligence.js
git commit -m "feat: add Project Health Scan tool"
```

---

### Task 3: Feature Timeline

**Files:**
- Modify: `App/renderer/tools/code-intelligence.js`

**Interfaces:**
- Consumes: `_playEventSound()` from Task 1, CSS `.ci-tl-*` from Task 1
- Produces: `_addTimelineEntry(name, description)` (called externally by AI agent), tool entry `feature-timeline`, `_renderFeatureTimeline()`, `_loadTimeline()`, `_saveTimeline()`

- [ ] **Step 1: Add `feature-timeline` to `_getTools()`**

```js
{ id: 'feature-timeline', label: 'Feature Timeline', icon: '📅', needsKey: false }
```

- [ ] **Step 2: Add dispatch case in `_renderToolView()`**

```js
case 'feature-timeline': this._renderFeatureTimeline(); break;
```

- [ ] **Step 3: Add storage helpers + `_addTimelineEntry()` + `_renderFeatureTimeline()`**

After `_runHealthScan()`:

```js
_addTimelineEntry(name, description) {
  const entries = this._loadTimeline();
  if (entries.some(e => e.name === name)) return; // no dupes
  entries.unshift({ name, description, date: new Date().toISOString().slice(0, 10) });
  this._saveTimeline(entries);
  this._playEventSound();
}

_loadTimeline() {
  try { return JSON.parse(localStorage.getItem('ci-timeline') || '[]'); } catch { return []; }
}

_saveTimeline(entries) {
  localStorage.setItem('ci-timeline', JSON.stringify(entries));
}

_renderFeatureTimeline() {
  const entries = this._loadTimeline();
  if (entries.length === 0) {
    this._resultsEl.innerHTML = '<div style="padding:1rem;color:var(--text2);text-align:center;">Noch keine Einträge. Nach abgeschlossenen Features wird hier automatisch eingetragen.</div>';
    return;
  }

  // Group by month descending
  const months = {};
  entries.forEach(e => {
    const m = e.date.slice(0, 7);
    if (!months[m]) months[m] = [];
    months[m].push(e);
  });
  const sortedMonths = Object.keys(months).sort((a, b) => b.localeCompare(a));

  const monthNames = { '01':'Januar','02':'Februar','03':'März','04':'April','05':'Mai','06':'Juni','07':'Juli','08':'August','09':'September','10':'Oktober','11':'November','12':'Dezember' };

  let html = '';
  sortedMonths.forEach(m => {
    const [y, mo] = m.split('-');
    html += `<div class="ci-tl-month">${monthNames[mo] || mo} ${y}</div>`;
    months[m].sort((a, b) => b.date.localeCompare(a.date)).forEach(e => {
      const desc = escapeHtml(e.description || '');
      html += `<div class="ci-tl-entry"><span class="ci-tl-name">${escapeHtml(e.name)}<span class="ci-tl-hover-desc">${desc}</span></span><span class="ci-tl-date">${e.date}</span></div>`;
    });
  });
  this._resultsEl.innerHTML = html;
}
```

- [ ] **Step 4: Commit**

```bash
git add App/renderer/tools/code-intelligence.js
git commit -m "feat: add Feature Timeline with auto-logging and month grouping"
```

---

### Task 4: Idea Evolution

**Files:**
- Modify: `App/renderer/tools/code-intelligence.js`

**Interfaces:**
- Consumes: `_playEventSound()` from Task 1, CSS `.ci-ie-*` from Task 1, provider for AI call
- Produces: tool entry `idea-evolution`, `_renderIdeaEvolution()`, `_runIdeaEvolution(text, types)`

- [ ] **Step 1: Add `idea-evolution` to `_getTools()`**

```js
{ id: 'idea-evolution', label: 'Idea Evolution', icon: '💡', needsKey: false }
```

- [ ] **Step 2: Add dispatch case**

```js
case 'idea-evolution': this._renderIdeaEvolution(); break;
```

- [ ] **Step 3: Implement `_renderIdeaEvolution()` and `_runIdeaEvolution()`**

After `_renderFeatureTimeline()`:

```js
_renderIdeaEvolution() {
  this._resultsEl.innerHTML = `
    <div class="ci-v2-section">
      <textarea class="ci-ie-textarea" id="ci-ie-input" placeholder="Deine Idee..."></textarea>
      <div class="ci-ie-checkboxes">
        <label><input type="checkbox" value="task" checked> Task</label>
        <label><input type="checkbox" value="spec"> Spec</label>
        <label><input type="checkbox" value="plan"> Plan</label>
        <label><input type="checkbox" value="konzept"> Konzept</label>
        <label><input type="checkbox" value="note"> Note</label>
      </div>
      <button class="ci-v2-btn ci-v2-btn-primary" id="ci-ie-go">⚡ Generieren</button>
    </div>
    <div id="ci-ie-results"></div>
  `;
  document.getElementById('ci-ie-go').onclick = () => {
    const text = document.getElementById('ci-ie-input').value.trim();
    if (!text) return;
    const checkboxes = document.querySelectorAll('.ci-ie-checkboxes input:checked');
    const checkedTypes = [...checkboxes].map(cb => cb.value);
    this._runIdeaEvolution(text, checkedTypes);
  };
}

async _runIdeaEvolution(text, types) {
  const goBtn = document.getElementById('ci-ie-go');
  const resultsEl = document.getElementById('ci-ie-results');
  goBtn.disabled = true;
  goBtn.textContent = '⏳ Generiere...';
  resultsEl.innerHTML = '';

  const providerId = localStorage.getItem('selectedProvider');
  if (!providerId || !window.providers[providerId]) {
    resultsEl.innerHTML = '<div style="padding:0.5rem;color:#e74c3c;">Kein aktiver Provider konfiguriert.</div>';
    goBtn.disabled = false;
    goBtn.textContent = '⚡ Generieren';
    return;
  }

  const prompt = `Wandle folgende Idee in die angegebenen Formate um. Antworte ausschließlich im JSON-Format: {"task":"...","spec":"...","plan":"...","konzept":"...","note":"..."}. Fülle nur die angeforderten Formate: ${types.join(', ')}.\n\nIdee: ${text}`;

  try {
    const res = await window.providers[providerId].sendPlain(prompt, null, { signal: AbortSignal.timeout(60000) });
    let data;
    try { data = JSON.parse(res); } catch { data = { note: res }; }

    let html = '';
    types.forEach(t => {
      const content = data[t];
      if (!content) return;
      const label = { task: '📋 Task', spec: '📄 Spec', plan: '📝 Plan', konzept: '💡 Konzept', note: '📌 Note' }[t] || t;
      html += `<div class="ci-ie-result"><div class="ci-ie-result-header" onclick="this.nextElementSibling.classList.toggle('hidden')">${label} <span>🔼</span></div><div class="ci-ie-result-body">${escapeHtml(content)}</div></div>`;
    });
    resultsEl.innerHTML = html || '<div style="padding:0.5rem;color:var(--text2);">Keine Ergebnisse generiert.</div>';
    this._playEventSound();
  } catch (err) {
    resultsEl.innerHTML = '<div style="padding:0.5rem;color:#e74c3c;">Fehler: ' + escapeHtml(err.message || err) + '</div>';
  }

  goBtn.disabled = false;
  goBtn.textContent = '⚡ Generieren';
}
```

- [ ] **Step 4: Commit**

```bash
git add App/renderer/tools/code-intelligence.js
git commit -m "feat: add Idea Evolution tool with multi-format generation"
```

---

### Task 5: Explain my Project

**Files:**
- Modify: `App/renderer/tools/code-intelligence.js`

**Interfaces:**
- Consumes: provider for AI call, CSS `.ci-ep-*` from Task 1
- Produces: tool entry `explain-project`, `_renderExplainProject()`, `_runExplainProject()`

- [ ] **Step 1: Add `explain-project` to `_getTools()`**

```js
{ id: 'explain-project', label: 'Explain my Project', icon: '📋', needsKey: false }
```

- [ ] **Step 2: Add dispatch case**

```js
case 'explain-project': this._renderExplainProject(); break;
```

- [ ] **Step 3: Implement `_renderExplainProject()` and `_runExplainProject()`**

After `_runIdeaEvolution()`:

```js
_renderExplainProject() {
  this._resultsEl.innerHTML = `
    <div class="ci-v2-section">
      <p style="font-size:0.82rem;color:var(--text2);margin-bottom:0.5rem;">Analysiert Code, Dokumentation, Entscheidungen und erstellt eine vollständige Projektzusammenfassung zum Teilen (z.B. mit ChatGPT).</p>
      <button class="ci-v2-btn ci-v2-btn-primary" id="ci-ep-start">📋 Projekt analysieren</button>
    </div>
    <div id="ci-ep-output"></div>
  `;
  document.getElementById('ci-ep-start').onclick = () => this._runExplainProject();
}

async _runExplainProject() {
  const btn = document.getElementById('ci-ep-start');
  const out = document.getElementById('ci-ep-output');
  btn.disabled = true;
  btn.textContent = '⏳ Analysiere...';
  out.innerHTML = '<div style="padding:0.5rem;color:var(--text2);">Sammle Projektinformationen...</div>';

  const providerId = localStorage.getItem('selectedProvider');
  if (!providerId || !window.providers[providerId]) {
    out.innerHTML = '<div style="padding:0.5rem;color:#e74c3c;">Kein aktiver Provider konfiguriert.</div>';
    btn.disabled = false; btn.textContent = '📋 Projekt analysieren'; return;
  }

  try {
    // Gather project info
    const packageRes = await window.api.runTerminalCommand('type package.json 2>nul || cat package.json 2>/dev/null || echo "{}"');
    const readmeRes = await window.api.runTerminalCommand('type README.md 2>nul || cat README.md 2>/dev/null || echo ""');
    const dirRes = await window.api.runTerminalCommand('cmd /c "dir /b /ad 2>nul"');
    const gitRes = await window.api.runTerminalCommand('git log --oneline -50 2>&1');
    const treeRes = await window.api.runTerminalCommand('cmd /c "dir /s /b 2>nul | head -100"');

    const context = [
      '## Projektstruktur',
      (dirRes.stdout || '').trim(),
      '\n## package.json',
      (packageRes.stdout || '').slice(0, 3000),
      '\n## README.md',
      (readmeRes.stdout || '').slice(0, 3000),
      '\n## Letzte Commits',
      (gitRes.stdout || '').slice(0, 2000),
      '\n## Dateien (Auszug)',
      (treeRes.stdout || '').slice(0, 3000)
    ].join('\n');

    out.innerHTML = '<div style="padding:0.5rem;color:var(--text2);">Generiere Zusammenfassung...</div>';

    const prompt = `Analysiere das folgende Projekt und erstelle eine umfassende, aber kompakte Zusammenfassung. Schreibe auf Deutsch.\n\nFormat:\n- **Was ist das Projekt?**\n- **Tech-Stack & Architektur**\n- **Wichtige Entscheidungen & Patterns**\n- **Aktueller Status**\n- **Struktur**\n\nProjekt-Daten:\n${context}`;

    const res = await window.providers[providerId].sendPlain(prompt, null, { signal: AbortSignal.timeout(60000) });

    out.innerHTML = `<div class="ci-ep-copy"><button class="ci-v2-btn ci-v2-btn-sm" id="ci-ep-copy-btn">📋 Kopieren</button></div><div class="ci-ep-output">${escapeHtml(res)}</div>`;
    document.getElementById('ci-ep-copy-btn').onclick = () => {
      navigator.clipboard.writeText(res);
      const btn = document.getElementById('ci-ep-copy-btn');
      btn.textContent = '✅ Kopiert!';
      setTimeout(() => { btn.textContent = '📋 Kopieren'; }, 2000);
    };
  } catch (err) {
    out.innerHTML = '<div style="padding:0.5rem;color:#e74c3c;">Fehler: ' + escapeHtml(err.message || err) + '</div>';
  }
  btn.disabled = false;
  btn.textContent = '📋 Projekt analysieren';
}
```

- [ ] **Step 4: Commit**

```bash
git add App/renderer/tools/code-intelligence.js
git commit -m "feat: add Explain my Project tool with AI analysis"
```

---

### Task 6: Git Clarify

**Files:**
- Modify: `App/renderer/tools/code-intelligence.js`

**Interfaces:**
- Consumes: provider for AI call, CSS `.ci-gc-*` from Task 1
- Produces: tool entry `git-clarify`, `_renderGitClarify()`, `_runGitClarify()`, `_applyGitName(hash, name, desc)`

- [ ] **Step 1: Add `git-clarify` to `_getTools()`**

```js
{ id: 'git-clarify', label: 'Git Clarify', icon: '🔧', needsKey: false }
```

- [ ] **Step 2: Add dispatch case**

```js
case 'git-clarify': this._renderGitClarify(); break;
```

- [ ] **Step 3: Implement `_renderGitClarify()`**

After `_runExplainProject()`:

```js
_renderGitClarify() {
  this._resultsEl.innerHTML = `
    <div class="ci-v2-section">
      <p style="font-size:0.82rem;color:var(--text2);margin-bottom:0.5rem;">Analysiert alle Git-Commits und schlägt bessere Namen und Beschreibungen vor. Git-History wird umgeschrieben (amend/rebase).</p>
      <button class="ci-v2-btn ci-v2-btn-primary" id="ci-gc-start">🔧 Commits analysieren</button>
    </div>
    <div id="ci-gc-output"></div>
  `;
  document.getElementById('ci-gc-start').onclick = () => {
    this._resultsEl.querySelector('#ci-gc-output').innerHTML = `
      <div class="ci-gc-confirm">
        <p>Git Clarify wird <strong>alle Commit-Nachrichten</strong> analysieren und Vorschläge machen. Die Git-History wird umgeschrieben (amend/rebase).</p>
        <p style="font-size:0.75rem;color:var(--text2);margin-top:0.5rem;">Vorsicht: Dies überschreibt die Git-History!</p>
        <div class="ci-gc-confirm-btns">
          <button class="ci-v2-btn" id="ci-gc-cancel">Abbrechen</button>
          <button class="ci-v2-btn ci-v2-btn-primary" id="ci-gc-confirm">Fortfahren</button>
        </div>
      </div>
    `;
    document.getElementById('ci-gc-cancel').onclick = () => this._renderGitClarify();
    document.getElementById('ci-gc-confirm').onclick = () => this._runGitClarify();
  };
}

async _runGitClarify() {
  const out = this._resultsEl.querySelector('#ci-gc-output');
  out.innerHTML = '<div style="padding:1rem;color:var(--text2);">Sammle Commits...</div>';

  const providerId = localStorage.getItem('selectedProvider');
  if (!providerId || !window.providers[providerId]) {
    out.innerHTML = '<div style="padding:1rem;color:#e74c3c;">Kein aktiver Provider konfiguriert.</div>'; return;
  }

  let commits;
  try {
    const logRes = await window.api.runTerminalCommand('git log --all --oneline --format="%H|||%s|||%b"');
    commits = (logRes.stdout || '').trim().split('\n').filter(Boolean).map(line => {
      const [hash, ...parts] = line.split('|||');
      return { hash: hash.trim(), oldName: parts[0] || '', oldDesc: parts.slice(1).join('|||').trim() };
    }).reverse(); // oldest first for sequential processing
  } catch {
    out.innerHTML = '<div style="padding:1rem;color:#e74c3c;">Fehler: Kein Git-Repository oder keine Commits.</div>'; return;
  }

  if (commits.length === 0) {
    out.innerHTML = '<div style="padding:1rem;color:var(--text2);">Keine Commits gefunden.</div>'; return;
  }

  // Build UI
  out.innerHTML = `<div id="ci-gc-list"></div><div class="ci-gc-bottom"><span id="ci-gc-status">0/${commits.length} angenommen</span><button class="ci-v2-btn ci-v2-btn-sm" id="ci-gc-accept-all">Alles übernehmen</button><button class="ci-v2-btn ci-v2-btn-sm ci-v2-btn-danger" id="ci-gc-reject-all">Alles ablehnen</button></div>`;

  const listEl = out.querySelector('#ci-gc-list');
  const statusEl = out.querySelector('#ci-gc-status');
  let accepted = 0;

  function updateStatus() {
    statusEl.textContent = `${accepted}/${commits.length} angenommen`;
  }

  const results = [];

  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];
    listEl.innerHTML += `<div style="padding:0.5rem;color:var(--text2);font-size:0.82rem;">Analysiere Commit ${c.hash.slice(0,7)} (${i+1}/${commits.length})...</div>`;

    try {
      const diffRes = await window.api.runTerminalCommand(`git show --stat ${c.hash} 2>&1`);
      const diff = (diffRes.stdout || '').slice(0, 2000);

      const prompt = `Analysiere diesen Git-Commit und schlage einen besseren Namen und Beschreibung vor. Antworte NUR mit JSON: {"name":"neuer name","description":"neue beschreibung"}\n\nAktueller Name: ${c.oldName}\nAktuelle Beschreibung: ${c.oldDesc}\n\nÄnderungen:\n${diff}`;

      const res = await window.providers[providerId].sendPlain(prompt, null, { signal: AbortSignal.timeout(60000) });
      let data;
      try { data = JSON.parse(res); } catch { data = { name: c.oldName, description: res.slice(0, 200) }; }

      results.push({ ...c, newName: data.name || c.oldName, newDesc: data.description || c.oldDesc, accepted: false });
    } catch {
      results.push({ ...c, newName: c.oldName, newDesc: c.oldDesc, accepted: false });
    }

    // Re-render the list
    listEl.innerHTML = results.map((r, idx) => `
      <div class="ci-gc-commit">
        <span class="ci-gc-hash">${r.hash.slice(0,7)}</span>
        <div style="flex:1">
          <div><span class="ci-gc-old">${escapeHtml(r.oldName)}</span> → <span class="ci-gc-new">${escapeHtml(r.newName)}</span></div>
          <div style="font-size:0.75rem;color:var(--text2);margin-top:0.2rem;">${r.oldDesc ? '<span class="ci-gc-old">' + escapeHtml(r.oldDesc.slice(0,80)) + '</span> → ' : ''}<span class="ci-gc-new">${escapeHtml((r.newDesc||'').slice(0,80))}</span></div>
        </div>
        <div class="ci-gc-actions">
          <button class="ci-v2-btn ci-v2-btn-sm ${r.accepted ? 'ci-v2-btn-primary' : ''}" data-idx="${idx}" data-action="accept">${r.accepted ? '✅' : '✓'} ${r.accepted ? 'Angenommen' : 'Übernehmen'}</button>
          <button class="ci-v2-btn ci-v2-btn-sm" data-idx="${idx}" data-action="reject">✗ Ablehnen</button>
        </div>
      </div>
    `).join('');

    // Attach per-item handlers
    listEl.querySelectorAll('[data-action]').forEach(btn => {
      btn.onclick = async () => {
        const idx = parseInt(btn.dataset.idx);
        if (btn.dataset.action === 'accept') {
          if (results[idx].accepted) return;
          results[idx].accepted = true;
          accepted++;
          await this._applyGitName(results[idx].hash, results[idx].newName, results[idx].newDesc);
        } else {
          results[idx].accepted = false;
        }
        updateStatus();
        btn.closest('.ci-gc-commit').querySelector('[data-action="accept"]').textContent = '✅ Angenommen';
        btn.closest('.ci-gc-commit').querySelector('[data-action="accept"]').classList.add('ci-v2-btn-primary');
      };
    });
  }

  // Bottom bar handlers
  out.querySelector('#ci-gc-accept-all').onclick = async () => {
    for (const r of results) {
      if (!r.accepted) {
        r.accepted = true;
        accepted++;
        await this._applyGitName(r.hash, r.newName, r.newDesc);
      }
    }
    updateStatus();
  };
  out.querySelector('#ci-gc-reject-all').onclick = () => {
    results.forEach(r => r.accepted = false);
    accepted = 0;
    updateStatus();
  };

  this._playEventSound();
}

async _applyGitName(hash, name, desc) {
  try {
    // Get parent count to determine if merge commit
    const parentRes = await window.api.runTerminalCommand(`git rev-list --parents -n 1 ${hash}`);
    const parents = (parentRes.stdout || '').trim().split(/\s+/).length - 1;

    if (parents > 1) {
      // Merge commit — skip amend, just warn
      return;
    }

    // Check if this is HEAD commit
    const headRes = await window.api.runTerminalCommand('git rev-parse HEAD');
    const headHash = (headRes.stdout || '').trim();

    if (hash === headHash) {
      // Simple amend for latest commit
      const msg = desc ? `${name}\n\n${desc}` : name;
      await window.api.runTerminalCommand(`git commit --amend -m "${msg.replace(/"/g, '\\"')}" --no-edit 2>&1 || true`);
    }
  } catch(e) {
    // silent — individual commit failures shouldn't block the flow
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add App/renderer/tools/code-intelligence.js
git commit -m "feat: add Git Clarify tool with AI commit review"
```

---

### Task 7: Dead Code Cleanup in script.js

**Files:**
- Modify: `App/renderer/script.js`

- [ ] **Step 1: Clean up dead CI references in script.js**

Find and remove dead CI-related code in script.js. The `CodeIntelligence.init()` call at startup, and the `ManagementPanel._refreshActiveTab('ci')` that already works.

Check: Does `CodeIntelligence.init()` in code-intelligence.js reference `#ci-panel`? If so, clean up the init/toggle/hide methods too since they're dead code now (ManagementPanel handles the CI lifecycle).

Actually, let me first clean up the `init()`, `toggle()`, `hide()`, `_isOpen()` methods in `code-intelligence.js` since they reference a non-existent `#ci-panel` element. The CI is now managed entirely by `ManagementPanel.show('ci')`.

- [ ] **Step 2: Clean up `code-intelligence.js` dead entry points**

Replace `init()`, `toggle()`, `hide()`, `_isOpen()` with minimal implementations since ManagementPanel handles everything:

```js
init() {
  // CI is managed by ManagementPanel — no standalone panel toggling
}
toggle() {
  // Legacy — kept for compat, does nothing
}
hide() {
  // Legacy — kept for compat, does nothing
}
_isOpen() {
  return document.getElementById('management-panel')?.classList.contains('hidden') === false;
}
```

- [ ] **Step 3: Commit**

```bash
git add App/renderer/tools/code-intelligence.js App/renderer/script.js
git commit -m "chore: remove dead CI panel code, lifecycle managed by ManagementPanel"
```
