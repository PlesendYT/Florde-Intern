# Task 4: Instrumentation — Add AuditLog.log() Calls

**Goal:** Add `AuditLog.log()` calls at key points in the code so KI actions are recorded in the new KI-Aktionen audit tab.

**File:** Modify `App/renderer/script.js`

**Context:** The existing code has:
- `PermissionManager.checkTool(toolName, args)` — decides allow/block/ask (line ~1114)
- `showPermissionPrompt(toolName, args, callback)` — shows modal with 4 buttons (line ~1152)
- Tool execution handlers in a switch statement (line ~3562) — these already call `addAuditEntry()` for the old cloud/local log
- `sendMessage()` function (line ~4132) — calls `addAuditEntry(isCloud ? 'cloud' : 'local', ...)` at line ~4169

**IMPORTANT:** There is already a function called `addAuditEntry()` at line 6 that logs to the old cloud/local audit log. This is SEPARATE from `AuditLog.log()`. The new calls to `AuditLog.log()` should be ADDED alongside existing `addAuditEntry()` calls, not replace them.

## Step 1: Log permission decisions in showPermissionPrompt

In `showPermissionPrompt` (line ~1152), modify each button handler to also call `AuditLog.log()`:

```javascript
function showPermissionPrompt(toolName, args, callback) {
  const existing = document.querySelector('.permission-prompt-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'permission-prompt-overlay';
  const act = formatToolActivity(toolName, args);
  showNotification('warning', 'Action Required: ' + act, '\u{1F512}');
  const desc = args.description ? '<div class="perm-desc"><strong>Summary:</strong> ' + escapeHtml(args.description) + '</div>' : '';
  overlay.innerHTML = '<div class="permission-prompt">' +
    '<h3>\u{1F512} AI Action Required</h3>' +
    '<p>The AI wants to <strong>' + escapeHtml(act) + '</strong></p>' +
    desc +
    '<div class="permission-actions">' +
      '<button class="btn-allow-once">Allow Once</button>' +
      '<button class="btn-allow-always">Always Allow</button>' +
      '<button class="btn-block-once">Block Once</button>' +
      '<button class="btn-block-always">Always Block</button>' +
    '</div>' +
  '</div>';
  document.body.appendChild(overlay);

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
}
```

Add this helper function right before or after `showPermissionPrompt`:
```javascript
function _toolAuditType(toolName) {
  if (toolName === 'exec_command') return 'command';
  if (toolName === 'read_file') return 'file_read';
  if (toolName === 'write_file' || toolName === 'edit_file') return 'file_write';
  if (toolName === 'browser_open') return 'api_access';
  return 'unknown';
}
```

## Step 2: Log auto-decisions in checkTool

In `PermissionManager.checkTool` (line ~1114), add `AuditLog.log()` calls:

For the auto-accept path (around line 1129, before `return true`):
Add inside the auto-accept block (after the risk check, before the `return true`):
```javascript
      AuditLog.log({ type: _toolAuditType(toolName), action: formatToolActivity(toolName, args), status: 'auto', summary: 'Automatisch erlaubt: ' + formatToolActivity(toolName, args), details: { tool: toolName, args: JSON.stringify(args) }, source: 'KI' });
```

For the 'allow' level (around line 1132, before `return true`):
```javascript
      AuditLog.log({ type: _toolAuditType(toolName), action: formatToolActivity(toolName, args), status: 'auto', summary: 'Automatisch erlaubt (Regel): ' + formatToolActivity(toolName, args), details: { tool: toolName, args: JSON.stringify(args) }, source: 'KI' });
```

For the 'block' level (around line 1135, before `return false`):
```javascript
      AuditLog.log({ type: _toolAuditType(toolName), action: formatToolActivity(toolName, args), status: 'blocked', summary: 'Blockiert (Regel): ' + formatToolActivity(toolName, args), details: { tool: toolName, args: JSON.stringify(args) }, source: 'KI' });
```

## Step 3: Log actual tool execution

In the `switch (name)` handler where tools are executed (around line ~3562), add `AuditLog.log()` after each `addAuditEntry()` call.

Find the pattern where `addAuditEntry('local', ...)` is called for each tool and add `AuditLog.log()` right after it. For example:
```javascript
    case 'read_file':
      if (!args || !args.path) throw new Error('path required for read_file');
      if (!project) throw new Error('No project open');
      addAuditEntry('local', 'Read_File: ' + sanitizePath(args.path));
      AuditLog.log({ type: 'file_read', action: 'Datei gelesen', status: 'auto', summary: 'Datei ' + sanitizePath(args.path) + ' gelesen', details: { file: sanitizePath(args.path) }, source: 'KI' });
      logToTerminal('Read_File: ' + sanitizePath(args.path), 'info');
      return await window.electronAPI.projectReadFile(project, sanitizePath(args.path));
```

Do the same for all tool cases that have `addAuditEntry`:
- `read_file` → type: 'file_read', action: 'Datei gelesen'
- `write_file`/batch write → type: 'file_write', action: 'Datei geschrieben'
- `delete_file` → type: 'file_write', action: 'Datei gelöscht'
- `edit_file` → type: 'file_write', action: 'Datei geändert'
- `rename_file` → type: 'file_write', action: 'Datei umbenannt'
- `take_screenshot` → type: 'unknown', action: 'Screenshot erstellt'
- `schedule_task` → type: 'command', action: 'Aufgabe geplant'

## Step 4: Log chat messages

Find the line with `addAuditEntry(isCloud ? 'cloud' : 'local', 'Nachricht gesendet an ' + provider);` (around line 4169) and add right after it:

```javascript
  AuditLog.log({ type: 'chat', action: 'Nachricht gesendet', status: 'auto', summary: 'Nachricht an ' + provider + ' (' + (isCloud ? 'Cloud' : 'Lokal') + ')', details: { provider, mode: isCloud ? 'cloud' : 'local' }, source: 'KI' });
```

## Verification

After all edits:
- Run: `node -e "const fs=require('fs'); const code=fs.readFileSync('App/renderer/script.js','utf8'); try { new Function(code); console.log('OK'); } catch(e) { console.log(e.message); }"`
- Expected: `OK`

## Report

Write report to `.superpowers/sdd/task-4-report.md`
