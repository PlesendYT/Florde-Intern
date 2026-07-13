# Enhanced Permission Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the minimal permission prompt overlay with a detailed, information-rich interface showing action type, file path, line changes, reason, risk level, risk explanation, plus "Ändern" and "Detailierter erklären" buttons.

**Architecture:** Enhance the existing `showPermissionPrompt()` function and CSS. No new files — all changes in `script.js` (one function rewrite plus helpers) and `style.css` (new sub-element classes).

**Tech Stack:** Vanilla JS, CSS

## Global Constraints

- Keep all existing functionality working (Allow/Block Once/Always, AuditLog logging, PermissionManager integration)
- AI calls for "Ändern" and "Detailierter erklären" use `providers[active].sendPlain()` with 30s AbortSignal timeout
- No reading files before permission is granted (privacy)
- All text labels in German where the spec specifies German

---

### Task 1: CSS styles for rich permission prompt

**Files:**
- Modify: `App/renderer/style.css` (append before the file end)

- [ ] **Step 1: Add CSS classes**

Append to `style.css`:

```css
/* ==================== ENHANCED PERMISSION PROMPT ==================== */
.perm-prompt-icon { font-size: 1.4rem; margin-bottom: 0.25rem; }
.perm-prompt-action { font-size: 1.1rem; font-weight: 600; color: var(--text); margin-bottom: 0.5rem; }
.perm-prompt-detail { font-size: 0.85rem; color: var(--text2); margin-bottom: 0.3rem; display: flex; align-items: center; gap: 0.4rem; }
.perm-prompt-detail strong { color: var(--text); min-width: 5rem; }
.perm-prompt-lines { font-family: monospace; font-size: 0.85rem; padding: 0.15rem 0.4rem; border-radius: 3px; }
.perm-prompt-lines.added { color: #22c55e; background: rgba(34,197,94,0.1); }
.perm-prompt-lines.removed { color: #ef4444; background: rgba(239,68,68,0.1); }
.perm-prompt-reason { font-size: 0.85rem; color: var(--text2); margin-bottom: 0.3rem; padding: 0.3rem 0.5rem; background: var(--bg3); border-radius: 4px; border-left: 3px solid var(--accent); }
.perm-prompt-risk { font-size: 0.85rem; margin-bottom: 0.3rem; display: flex; align-items: center; gap: 0.4rem; }
.perm-risk-badge { font-size: 0.75rem; font-weight: 600; padding: 0.15rem 0.5rem; border-radius: 4px; }
.perm-risk-badge.critical { background: rgba(239,68,68,0.2); color: #ef4444; }
.perm-risk-badge.high { background: rgba(239,68,68,0.15); color: #f87171; }
.perm-risk-badge.medium { background: rgba(234,179,8,0.15); color: #eab308; }
.perm-risk-badge.low { background: rgba(34,197,94,0.15); color: #22c55e; }
.perm-risk-badge.safe { background: rgba(34,197,94,0.1); color: #4ade80; }
.perm-prompt-explain { font-size: 0.8rem; color: var(--text3); padding: 0.3rem 0.5rem; background: var(--bg3); border-radius: 4px; margin-bottom: 0.5rem; border-left: 3px solid var(--text3); }
.perm-prompt-extra-btns { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
.perm-prompt-extra-btns button { padding: 0.35rem 0.7rem; border-radius: 6px; border: 1px solid var(--border); background: var(--bg3); color: var(--text); cursor: pointer; font-size: 0.78rem; }
.perm-prompt-extra-btns button:hover { background: var(--hover); }
.perm-prompt-divider { border: none; border-top: 1px solid var(--border); margin: 0.5rem 0; }
.perm-prompt-detail-section { margin-top: 0.75rem; padding: 0.5rem; background: var(--bg3); border-radius: 6px; max-height: 200px; overflow-y: auto; font-size: 0.8rem; color: var(--text2); line-height: 1.5; border: 1px solid var(--border); }
.perm-prompt-detail-section.loading { opacity: 0.6; }
.perm-prompt-textarea { width: 100%; min-height: 60px; padding: 0.4rem; background: var(--bg1); border: 1px solid var(--border2); color: var(--text); border-radius: 4px; font-size: 0.85rem; resize: vertical; box-sizing: border-box; margin-bottom: 0.5rem; }
.perm-prompt-textarea-row { display: flex; gap: 0.3rem; align-items: flex-start; }
```

- [ ] **Step 2: Verify no CSS syntax errors**

Manually scan the added block for matching braces and valid property names.

- [ ] **Step 3: Commit**

```bash
git add App/renderer/style.css
git commit -m "feat(css): add enhanced permission prompt styles"
```

---

### Task 2: Helper functions for structured tool info

**Files:**
- Modify: `App/renderer/script.js` (add helper functions before `showPermissionPrompt`)

- [ ] **Step 1: Add `_permToolInfo(toolName, args)` helper**

Add this function right before `showPermissionPrompt` (before line 1163):

```javascript
function _permToolInfo(toolName, args) {
  const info = { icon: '', action: '', path: '', linesAdded: 0, linesRemoved: 0, hasLines: false, reason: '', risk: '', riskLabel: '', riskExplanation: '' };
  const reason = args.description || '';
  info.reason = reason;
  switch (toolName) {
    case 'read_file':
      info.icon = '📖'; info.action = 'Lesen'; info.path = args.path || '';
      info.risk = 'low'; info.riskLabel = 'Niedrig'; info.riskExplanation = 'Die KI möchte eine Datei lesen. Keine Änderungen am Projekt.';
      break;
    case 'write_file':
      info.icon = '✏️'; info.action = 'Schreiben'; info.path = args.path || '';
      if (args.content) info.linesAdded = args.content.split('\n').length;
      info.hasLines = true;
      info.risk = 'medium'; info.riskLabel = 'Mittel'; info.riskExplanation = 'Die KI möchte eine Datei schreiben. Dies kann bestehenden Code überschreiben.';
      break;
    case 'edit_file':
      info.icon = '🔧'; info.action = 'Bearbeiten'; info.path = args.path || '';
      if (args.oldString) info.linesRemoved = args.oldString.split('\n').length;
      if (args.newString) info.linesAdded = args.newString.split('\n').length;
      info.hasLines = true;
      info.risk = 'medium'; info.riskLabel = 'Mittel'; info.riskExplanation = 'Die KI möchte bestehenden Code durch neuen ersetzen.';
      break;
    case 'delete_file':
      info.icon = '🗑️'; info.action = 'Löschen'; info.path = args.path || '';
      info.risk = 'high'; info.riskLabel = 'Hoch'; info.riskExplanation = 'Die KI möchte eine Datei unwiderruflich löschen.';
      break;
    case 'rename_file':
      info.icon = '📝'; info.action = 'Umbenennen'; info.path = (args.path || '') + ' → ' + (args.new_path || '');
      info.risk = 'medium'; info.riskLabel = 'Mittel'; info.riskExplanation = 'Die KI möchte eine Datei umbenennen. Verweise könnten brechen.';
      break;
    case 'exec_command': {
      info.icon = '⚡'; info.action = 'Ausführen'; info.path = args.command || '';
      const shellRisk = assessShellRisk(args.command || '');
      if (shellRisk === 'critical') { info.risk = 'critical'; info.riskLabel = 'Kritisch'; }
      else if (shellRisk === 'high') { info.risk = 'high'; info.riskLabel = 'Hoch'; }
      else if (shellRisk === 'medium') { info.risk = 'medium'; info.riskLabel = 'Mittel'; }
      else if (shellRisk === 'low') { info.risk = 'low'; info.riskLabel = 'Niedrig'; }
      else { info.risk = 'safe'; info.riskLabel = 'Sicher'; }
      info.riskExplanation = 'Risikobewertung basierend auf Shell-Befehl: ' + info.riskLabel;
      break;
    }
    case 'ask_question':
      info.icon = '❓'; info.action = 'Fragen'; info.path = args.question || '';
      info.risk = 'low'; info.riskLabel = 'Niedrig'; info.riskExplanation = 'Die KI möchte eine Frage stellen. Keine Dateiänderung.';
      break;
    default:
      info.icon = '🔧'; info.action = toolName; info.path = Object.values(args).filter(v => typeof v === 'string').join(', ').slice(0, 80);
      info.risk = 'medium'; info.riskLabel = 'Mittel'; info.riskExplanation = 'Die KI möchte eine Aktion ausführen.';
  }
  return info;
}
```

- [ ] **Step 2: Commit**

```bash
git add App/renderer/script.js
git commit -m "feat: add _permToolInfo helper for structured tool data"
```

---

### Task 3: Rewrite showPermissionPrompt with rich layout

**Files:**
- Modify: `App/renderer/script.js` (replace `showPermissionPrompt` function at line 1163)

- [ ] **Step 1: Replace `showPermissionPrompt` function**

Replace lines 1163-1207 entirely with:

```javascript
function showPermissionPrompt(toolName, args, callback) {
  const existing = document.querySelector('.permission-prompt-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'permission-prompt-overlay';
  const info = _permToolInfo(toolName, args);
  const act = formatToolActivity(toolName, args);
  showNotification('warning', 'Action Required: ' + act, '\u{1F512}');

  // Build line changes display
  let linesHtml = '';
  if (info.hasLines) {
    const parts = [];
    if (info.linesAdded > 0) parts.push('<span class="perm-prompt-lines added">+' + info.linesAdded + ' Zeilen</span>');
    if (info.linesRemoved > 0) parts.push('<span class="perm-prompt-lines removed">-' + info.linesRemoved + ' Zeilen</span>');
    if (parts.length) linesHtml = '<div class="perm-prompt-detail"><strong>📊 Änderungen:</strong> ' + parts.join(', ') + '</div>';
  }

  overlay.innerHTML = '<div class="permission-prompt">' +
    '<h3>\u{1F512} AI-Zugriffsanfrage</h3>' +
    '<div class="perm-prompt-icon">' + info.icon + '</div>' +
    '<div class="perm-prompt-action">' + escapeHtml(info.action) + '</div>' +
    (info.path ? '<div class="perm-prompt-detail"><strong>📄 Datei:</strong> ' + escapeHtml(info.path) + '</div>' : '') +
    linesHtml +
    (info.reason ? '<div class="perm-prompt-reason"><strong>💬 Grund:</strong> ' + escapeHtml(info.reason) + '</div>' : '') +
    '<div class="perm-prompt-risk"><strong>⚠️ Risiko:</strong> <span class="perm-risk-badge ' + info.risk + '">' + info.riskLabel + '</span></div>' +
    '<div class="perm-prompt-explain">' + escapeHtml(info.riskExplanation) + '</div>' +
    '<div id="perm-detail-area"></div>' +
    '<div class="perm-prompt-extra-btns">' +
      '<button id="btn-perm-edit">✏️ Ändern</button>' +
      '<button id="btn-perm-explain">🔍 Detailierter erklären</button>' +
    '</div>' +
    '<hr class="perm-prompt-divider">' +
    '<div class="permission-actions">' +
      '<button class="btn-allow-once" style="background:var(--accent);color:#fff;">✅ Allow Once</button>' +
      '<button class="btn-allow-always">✅ Always Allow</button>' +
      '<button class="btn-block-once" style="background:#ef4444;color:#fff;">❌ Block Once</button>' +
      '<button class="btn-block-always">❌ Always Block</button>' +
    '</div>' +
  '</div>';
  document.body.appendChild(overlay);

  // ---- wire Allow/Block buttons ----
  overlay.querySelector('.btn-allow-once').onclick = () => {
    overlay.remove();
    AuditLog.log({ type: _toolAuditType(toolName), action: act, status: 'allowed', summary: act + ' (erlaubt, einmalig)', details: { tool: toolName, args: JSON.stringify(args) }, source: 'KI' });
    callback(true);
  };
  overlay.querySelector('.btn-allow-always').onclick = () => {
    PermissionManager.setPermission(toolName, 'allow');
    overlay.remove();
    AuditLog.log({ type: _toolAuditType(toolName), action: act, status: 'allowed', summary: act + ' (immer erlauben)', details: { tool: toolName, args: JSON.stringify(args) }, source: 'KI' });
    callback(true);
  };
  overlay.querySelector('.btn-block-once').onclick = () => {
    overlay.remove();
    AuditLog.log({ type: _toolAuditType(toolName), action: act, status: 'blocked', summary: act + ' (blockiert, einmalig)', details: { tool: toolName, args: JSON.stringify(args) }, source: 'KI' });
    callback(false);
  };
  overlay.querySelector('.btn-block-always').onclick = () => {
    PermissionManager.setPermission(toolName, 'block');
    overlay.remove();
    AuditLog.log({ type: _toolAuditType(toolName), action: act, status: 'blocked', summary: act + ' (immer blockieren)', details: { tool: toolName, args: JSON.stringify(args) }, source: 'KI' });
    callback(false);
  };

  // ---- wire "Ändern" button ----
  document.getElementById('btn-perm-edit').onclick = () => _permEditFlow(overlay, toolName, args, callback);

  // ---- wire "Detailierter erklären" button ----
  document.getElementById('btn-perm-explain').onclick = () => _permExplainFlow(overlay, toolName, args);
}
```

- [ ] **Step 2: Verify syntax**

```bash
node -e "const fs=require('fs'); const code=fs.readFileSync('App/renderer/script.js','utf8'); try { new Function(code); console.log('OK'); } catch(e) { console.log('ERROR:', e.message); }"
```

Expected: OK

- [ ] **Step 3: Commit**

```bash
git add App/renderer/script.js
git commit -m "feat: enhance permission prompt with rich layout and action info"
```

---

### Task 4: Implement "Ändern" flow

**Files:**
- Modify: `App/renderer/script.js` (add `_permEditFlow` helper)

- [ ] **Step 1: Add `_permEditFlow` function**

Add after `showPermissionPrompt`:

```javascript
function _permEditFlow(overlay, toolName, args, callback) {
  const detailArea = overlay.querySelector('#perm-detail-area');
  detailArea.innerHTML =
    '<textarea id="perm-edit-textarea" class="perm-prompt-textarea" placeholder="Was soll anders sein? (z.B. \'Mach Buy Now statt Buy\')"></textarea>' +
    '<div class="perm-prompt-textarea-row">' +
      '<button id="btn-perm-edit-submit" style="background:var(--accent);border:none;color:#fff;border-radius:4px;padding:0.35rem 0.8rem;cursor:pointer;font-size:0.8rem;">Senden</button>' +
      '<button id="btn-perm-edit-cancel" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:0.35rem 0.8rem;cursor:pointer;font-size:0.8rem;">Abbrechen</button>' +
      '<span id="perm-edit-status" style="font-size:0.75rem;color:var(--text3);margin-left:auto;"></span>' +
    '</div>';

  document.getElementById('btn-perm-edit-submit').onclick = async () => {
    const input = document.getElementById('perm-edit-textarea');
    const status = document.getElementById('perm-edit-status');
    const submitBtn = document.getElementById('btn-perm-edit-submit');
    if (!input.value.trim()) return;
    submitBtn.disabled = true;
    status.textContent = '⏳ Wird an KI gesendet...';
    try {
      const providerId = document.getElementById('provider-select')?.value;
      const prov = providerId ? providers[providerId] : null;
      if (!prov || !prov.sendPlain) { status.textContent = '❌ Kein aktiver Provider.'; submitBtn.disabled = false; return; }
      const recentMsgs = (typeof chatHistory !== 'undefined' ? chatHistory : []).filter(m => m.role !== 'system').slice(-3);
      const promptText = 'Du hast einen Tool-Call vorbereitet. Der Benutzer möchte eine Änderung:\n\n' +
        'Tool: ' + toolName + '\n' +
        'Aktuelle Argumente: ' + JSON.stringify(args, null, 2) + '\n\n' +
        'Benutzerwunsch: ' + input.value.trim() + '\n\n' +
        'Antworte NUR mit einem gültigen JSON-Objekt, das die neuen Argumente für denselben Tool-Call enthält. ' +
        'Behalte alle Felder bei, die der Benutzer nicht explizit ändern wollte.';
      const allMsgs = recentMsgs.concat([{ role: 'user', content: promptText }]);
      const resp = await prov.sendPlain(allMsgs, { signal: AbortSignal.timeout(30000) });
      const text = typeof resp === 'string' ? resp : (resp?.content || resp?.message?.content || JSON.stringify(resp));
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) throw new Error('Kein JSON in Antwort');
      const newArgs = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      status.textContent = '✅ Aktualisiert!';
      setTimeout(() => { overlay.remove(); showPermissionPrompt(toolName, newArgs, callback); }, 500);
    } catch (e) {
      status.textContent = '❌ Fehler: ' + (e.message || e);
      submitBtn.disabled = false;
    }
  };
  document.getElementById('btn-perm-edit-cancel').onclick = () => {
    detailArea.innerHTML = '';
  };
}
```

- [ ] **Step 2: Syntax check**

```bash
node -e "const fs=require('fs'); const code=fs.readFileSync('App/renderer/script.js','utf8'); try { new Function(code); console.log('OK'); } catch(e) { console.log('ERROR:', e.message); }"
```

Expected: OK

- [ ] **Step 3: Commit**

```bash
git add App/renderer/script.js
git commit -m "feat: implement 'Ändern' flow in permission prompt"
```

---

### Task 5: Implement "Detailierter erklären" flow

**Files:**
- Modify: `App/renderer/script.js` (add `_permExplainFlow` helper)

- [ ] **Step 1: Add `_permExplainFlow` function**

Add after `_permEditFlow`:

```javascript
function _permExplainFlow(overlay, toolName, args) {
  const detailArea = overlay.querySelector('#perm-detail-area');
  if (detailArea.querySelector('.perm-prompt-detail-section')) {
    detailArea.innerHTML = '';
    return;
  }
  detailArea.innerHTML = '<div class="perm-prompt-detail-section loading">⏳ Lade detaillierte Erklärung...</div>';
  document.getElementById('btn-perm-explain').disabled = true;

  (async () => {
    try {
      const providerId = document.getElementById('provider-select')?.value;
      const prov = providerId ? providers[providerId] : null;
      if (!prov || !prov.sendPlain) {
        detailArea.innerHTML = '<div class="perm-prompt-detail-section">❌ Kein aktiver Provider verfügbar.</div>';
        document.getElementById('btn-perm-explain').disabled = false;
        return;
      }
      const recentMsgs = (typeof chatHistory !== 'undefined' ? chatHistory : []).filter(m => m.role !== 'system').slice(-3);
      const promptText = 'Erkläre detailliert, was du mit folgendem Tool-Call erreichen willst. Beschreibe den Zweck, die Auswirkungen und warum dieser Schritt notwendig ist.\n\n' +
        'Tool: ' + toolName + '\n' +
        'Argumente: ' + JSON.stringify(args, null, 2);
      const allMsgs = recentMsgs.concat([{ role: 'user', content: promptText }]);
      const resp = await prov.sendPlain(allMsgs, { signal: AbortSignal.timeout(30000) });
      const text = typeof resp === 'string' ? resp : (resp?.content || resp?.message?.content || JSON.stringify(resp));
      detailArea.innerHTML = '<div class="perm-prompt-detail-section">' + escapeHtml(text) + '</div>';
    } catch (e) {
      detailArea.innerHTML = '<div class="perm-prompt-detail-section">❌ Fehler: ' + escapeHtml(e.message || e) + '</div>';
    }
    document.getElementById('btn-perm-explain').disabled = false;
  })();
}
```

- [ ] **Step 2: Syntax check**

```bash
node -e "const fs=require('fs'); const code=fs.readFileSync('App/renderer/script.js','utf8'); try { new Function(code); console.log('OK'); } catch(e) { console.log('ERROR:', e.message); }"
```

Expected: OK

- [ ] **Step 3: Commit**

```bash
git add App/renderer/script.js
git commit -m "feat: implement 'Detailierter erklären' flow in permission prompt"
```

---

### Task 6: Update showSandboxDeniedUI to match

**Files:**
- Modify: `App/renderer/script.js` (update `showSandboxDeniedUI` at line 1209)

- [ ] **Step 1: Update `showSandboxDeniedUI`**

Replace lines 1209-1233 with enhanced version using the same visual style:

```javascript
function showSandboxDeniedUI(toolName, args, callback) {
  const existing = document.querySelector('.permission-prompt-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'permission-prompt-overlay';
  const path = args.path || args.command || args.query || 'unknown';
  overlay.innerHTML = '<div class="permission-prompt" style="border-color:#ef4444;">' +
    '<h3>\u{1F512} Sandbox-Zugriff verweigert</h3>' +
    '<div class="perm-prompt-icon">🚫</div>' +
    '<div class="perm-prompt-action">Zugriff auf: ' + escapeHtml(path) + '</div>' +
    '<pre>' + escapeHtml(JSON.stringify(args, null, 2)) + '</pre>' +
    '<hr class="perm-prompt-divider">' +
    '<div class="permission-actions">' +
      '<button class="btn-allow-once" style="background:#ef4444;color:#fff;">✅ Allow Once</button>' +
      '<button class="btn-allow-always" style="background:#ef4444;color:#fff;">✅ Always Allow</button>' +
      '<button class="btn-block-once">❌ Deny Once</button>' +
      '<button class="btn-block-always">❌ Always Block</button>' +
    '</div>' +
  '</div>';
  document.body.appendChild(overlay);

  overlay.querySelector('.btn-allow-once').onclick = () => { overlay.remove(); callback(true); };
  overlay.querySelector('.btn-allow-always').onclick = () => { PermissionManager.setPermission(toolName, 'allow'); overlay.remove(); callback(true); };
  overlay.querySelector('.btn-block-once').onclick = () => { overlay.remove(); callback(false); };
  overlay.querySelector('.btn-block-always').onclick = () => { PermissionManager.setPermission(toolName, 'block'); overlay.remove(); callback(false); };
}
```

- [ ] **Step 2: Syntax check**

```bash
node -e "const fs=require('fs'); const code=fs.readFileSync('App/renderer/script.js','utf8'); try { new Function(code); console.log('OK'); } catch(e) { console.log('ERROR:', e.message); }"
```

Expected: OK

- [ ] **Step 3: Commit**

```bash
git add App/renderer/script.js
git commit -m "feat: update showSandboxDeniedUI to match new permission prompt style"
```

---

### Task 7: Final verification

- [ ] **Step 1: Verify syntax on final state**

```bash
node -e "const fs=require('fs'); const code=fs.readFileSync('App/renderer/script.js','utf8'); try { new Function(code); console.log('OK'); } catch(e) { console.log('ERROR:', e.message); }"
```

Expected: OK

- [ ] **Step 2: Check CSS braces are balanced**

```bash
node -e "const fs=require('fs'); const css=fs.readFileSync('App/renderer/style.css','utf8'); const opens=(css.match(/\{/g)||[]).length; const closes=(css.match(/\}/g)||[]).length; console.log('Braces:', opens, '/', closes, opens===closes?'OK':'MISMATCH');"
```

Expected: Braces: N / N OK

- [ ] **Step 3: Verify no console errors in key functions**

```bash
node -e "const fs=require('fs'); const code=fs.readFileSync('App/renderer/script.js','utf8'); if(code.includes('_permToolInfo')&&code.includes('_permEditFlow')&&code.includes('_permExplainFlow')&&code.includes('showPermissionPrompt')) console.log('All functions present'); else console.log('MISSING FUNCTIONS');"
```

Expected: All functions present

- [ ] **Step 4: Commit if anything changed**

```bash
git add App/renderer/style.css App/renderer/script.js
git commit -m "chore: final verification"
```
