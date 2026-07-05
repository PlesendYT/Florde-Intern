# Plan 3: Security, Shell & Settings

**Files:**
- Modify: `App/renderer/script.js` — timeout, auto-accept, shell view, risk assessment, backoff, key validation, plugin fix
- Modify: `App/renderer/index.html` — settings UI, shell view, permission modals
- Modify: `App/renderer/style.css` — risk colors, shell view, warning styles
- Modify: `App/main.js` — IPC for ollama list (if needed)
- Modify: `App/preload.js` — expose APIs

## Tasks

### Task 1: Configurable Timeout
- Add timeout input in settings (default: 30 min, unit: minutes)
- Timeout timer starts on each AI request
- Resets on: any response token, tool execution, shell output, download progress
- Paused during: permission prompt waiting
- When timeout reached: cancel request, show message in chat
- UI: countdown visible when < 5 min remaining

### Task 2: Auto-Accept System
- Add toggle "Auto Accept" (default: OFF)
- When ON: auto-confirm write/read/edit/create operations
- Exceptions (each configurable, default ASK):
  - Shell execution
  - Outside project access
  - Git operations
  - Terminal operations
- "Manage Auto Exceptions" button (visible when Auto Accept ON)
- Opens sub-settings with Allow/Ask/Block per category
- Store in localStorage (florde-settings key)

### Task 3: Sandbox Denied UI
- In `executeToolCall`: catch sandbox access errors
- Instead of raw error: show red styled permission box in chat
- Text: "🔒 Der Agent möchte auf [path] zugreifen"
- Buttons: Allow Once / Always Allow / Deny
- Style: red border, warning icon

### Task 4: Shell Risk Assessment
- Risk levels: Safe, Low, Medium, High, Critical
- Pattern matching (override detection — higher wins):
  - Critical: `rm -rf /`, `format`, `dd if=/dev/zero`, `mkfs`, bootloader commands
  - High: `sudo`, `rm -rf` (without `/`), `curl|sh`, `wget|sh`, `chmod -R 777`, network scans
  - Medium: `npm install`, `git push`, `pip install`, `chmod`, `kill`
  - Low: `mkdir`, `touch`, `echo > file`, `mv`, `cp`, `cd`
  - Safe: `ls`, `pwd`, `cat`, `head`, `tail`, `grep`, `find`
- AI also provides risk assessment — override detection: pattern match wins if higher
- Display assessed risk level with color coding

### Task 5: Expandable Shell View
- Shell execution shows collapsible detail panel
- Details: full command, live stdout/stderr, exit code, runtime
- Action buttons: Stop Process, Restart, Copy Command, Ask Florde What The Command Does
- "Ask Florde" sends command to AI for explanation
- Panel collapsed by default, expandable via `▼` button

### Task 6: Critical Shell Warning
- Critical risk: ALWAYS show full red warning (ignores Auto Accept)
- Warning content: AI explanation (why critical, risks, what command does)
- Button: **Hold 10s to confirm** (progress animation on button)
- After hold: second button "Confirm execution" (single click)
- Escape hatch: Cancel button always visible

### Task 7: 429 Exponential Backoff
- On 429 response: start backoff timer (1s, 2s, 4s... max 60s)
- Show countdown in AI Activity: "Rate Limited — Retry in Xs"
- Save last successful step index/message
- On retry success: continue from saved position
- Store progress in memory (per conversation)

### Task 8: API Key Validation
- Validate button per provider (in settings)
- Sends "say yes" to model
- Results:
  - **Valid:** any response received → green checkmark
  - **Limited:** 429, 402, timeout(3min) → yellow warning "valid but limited"
  - **Invalid:** 401, 403, model_not_found, bad_endpoint, connection error → red "invalid"
- Show validation result icon next to API key field

### Task 9: Plugin Disable Fix
- In `getActiveTools()` and `getActivePromptExtensions()`: check `p.enabled` === true (not just truthy)
- After toggle: re-run `updateAITools()` to refresh AI tool list
- Ensure disabled plugin tools don't appear in AI system prompt
