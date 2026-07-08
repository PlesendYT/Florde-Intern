# Agent Mode Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Erweiterung des bestehenden Agent Mode um Step-by-Step Execution, Plan Editing, Progress Tracking und Audit Trail.

**Architecture:** Bestehende Plan-Mode-Logik in `sendMessage()` erweitern; Plan-Modal in `showPlanModal()` ersetzen.

**Tech Stack:** Electron, vanilla JS, DOM-Manipulation

## Global Constraints
- Kein Build-Step, keine externen Dependencies
- Änderungen in `App/renderer/script.js`, `App/renderer/index.html`, `App/renderer/style.css`

---

### Task 1: Plan Editing (Textarea statt Read-only)

**Files:**
- Modify: `App/renderer/script.js` (Funktion `showPlanModal`)
- Modify: `App/renderer/index.html` (Plan-Modal HTML)
- Modify: `App/renderer/style.css`

- [ ] **Step 1: Replace modal content with textarea**

In `index.html`, find the plan modal and replace read-only content with textarea:

```
<!-- Plan Modal -->
<div id="plan-modal" class="modal-overlay hidden">
  <div class="modal-content" style="max-width:600px;">
    <h2>Execution Plan</h2>
    <textarea id="plan-content" class="plan-textarea" readonly></textarea>
    <p style="font-size:0.8rem;color:var(--text3);margin:0.5rem 0;">Click the plan to edit it before approving.</p>
    <div class="modal-actions">
      <button id="btn-plan-execute" class="btn btn-primary">Execute</button>
      <button id="btn-plan-cancel" class="btn btn-secondary">Cancel</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add CSS for plan textarea**

In `style.css`:
```
.plan-textarea { width: 100%; min-height: 200px; padding: 0.5rem; border: 1px solid var(--border); border-radius: 4px; background: var(--bg3); color: var(--text); font-family: inherit; font-size: 0.85rem; resize: vertical; }
.plan-textarea:focus { outline: none; border-color: var(--accent); }
.plan-textarea[readonly] { opacity: 0.8; }
.plan-textarea:not([readonly]) { opacity: 1; border-color: var(--accent); }
```

- [ ] **Step 3: Update showPlanModal to toggle readonly on click**

```
function showPlanModal(plan) {
  return new Promise(resolve => {
    const modal = document.getElementById('plan-modal');
    const content = document.getElementById('plan-content');
    content.value = plan;
    content.readOnly = true;
    modal.classList.remove('hidden');
    // Click to edit
    content.addEventListener('click', function toggle() {
      this.readOnly = !this.readOnly;
      if (!this.readOnly) this.focus();
    }, { once: true });
    const execute = document.getElementById('btn-plan-execute');
    const cancel = document.getElementById('btn-plan-cancel');
    const cleanup = () => {
      modal.classList.add('hidden');
      execute.removeEventListener('click', onExecute);
      cancel.removeEventListener('click', onCancel);
    };
    const onExecute = () => { cleanup(); resolve(content.value); };
    const onCancel = () => { cleanup(); resolve(null); };
    execute.addEventListener('click', onExecute);
    cancel.addEventListener('click', onCancel);
  });
}
```

- [ ] **Step 4: Update caller to use edited plan**

In `sendMessage()`, `showPlanModal` wird aufgerufen. Ändern von `if (!approved) return;` zu:

```
const plan = await showPlanModal(planText);
if (!plan) return;
chatHistory.push({ role: 'system', content: 'Approved execution plan:\n' + plan });
```

- [ ] **Step 5: Verify syntax**

Run: `node -e "new Function(require('fs').readFileSync('App/renderer/script.js','utf8'))" && echo OK`

---

### Task 2: Step-by-Step Execution with Progress

**Files:**
- Modify: `App/renderer/script.js` (in `sendMessage`, Tool-Loop-Bereich)
- Modify: `App/renderer/style.css`

- [ ] **Step 1: Add step tracking UI in sendMessage**

Nach dem Plan-Approval, vor dem Tool-Loop:

```
// Agent Mode: Step tracking
let _stepIndex = 0;
let _totalSteps = 0;
if (plan) {
  _totalSteps = (plan.match(/^\d+\./gm) || []).length;
  _stepIndex = 0;
}
```

- [ ] **Step 2: Add progress indicator per tool call**

In der Tool-Schleife (vor `executeToolCall`), nach `stopAnim()` und dem `startAnim`-Aufruf:

```
if (plan) {
  _stepIndex++;
  const stepEl = document.createElement('div');
  stepEl.className = 'agent-step';
  stepEl.innerHTML = '<span class="agent-step-num">Step ' + _stepIndex + '/' + _totalSteps + '</span>: ' +
    '<span class="agent-step-name">' + formatToolActivity(name, args) + '</span>' +
    '<span class="agent-step-bar"><span class="agent-step-progress" style="width:' + (_stepIndex / _totalSteps * 100) + '%"></span></span>';
  const aiMsg = document.querySelector('.chat-msg.ai:last-child');
  if (aiMsg) aiMsg.appendChild(stepEl);
}
```

- [ ] **Step 3: Add CSS for step indicator**

In `style.css`:
```
.agent-step { display: flex; align-items: center; gap: 0.5rem; padding: 0.3rem 0.5rem; margin: 0.2rem 0; background: var(--bg3); border-radius: 4px; font-size: 0.8rem; }
.agent-step-num { color: var(--accent); font-weight: 600; white-space: nowrap; }
.agent-step-name { color: var(--text2); flex: 1; }
.agent-step-bar { width: 60px; height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
.agent-step-progress { height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.3s; }
```

- [ ] **Step 4: Add step confirmation (Continue/Skip)**

Nach jedem `executeToolCall` in der Tool-Schleife (nur im Plan-Mode):

```
if (plan && _stepIndex < _totalSteps) {
  const confirmed = await new Promise(resolve => {
    const cont = document.createElement('div');
    cont.className = 'agent-step-actions';
    cont.innerHTML = '<button class="btn btn-sm btn-primary agent-continue">Continue</button>' +
      '<button class="btn btn-sm btn-secondary agent-skip">Skip</button>';
    const aiMsg = document.querySelector('.chat-msg.ai:last-child');
    if (aiMsg) aiMsg.appendChild(cont);
    cont.querySelector('.agent-continue').onclick = () => { cont.remove(); resolve(true); };
    cont.querySelector('.agent-skip').onclick = () => { cont.remove(); resolve(false); };
  });
  if (!confirmed) {
    // Mark as skipped and continue
    const stepEl = document.querySelector('.agent-step:last-child');
    if (stepEl) stepEl.style.opacity = '0.5';
  }
}
```

- [ ] **Step 5: Add CSS for step actions**

In `style.css`:
```
.agent-step-actions { display: flex; gap: 0.3rem; padding: 0.2rem 0.5rem; }
.agent-continue, .agent-skip { font-size: 0.75rem; padding: 0.2rem 0.5rem; }
```

- [ ] **Step 6: Verify syntax**

Run: `node -e "new Function(require('fs').readFileSync('App/renderer/script.js','utf8'))" && echo OK`

---

### Task 3: Audit Trail & Toggle Persistence

**Files:**
- Modify: `App/renderer/script.js` (in sendMessage + loadSettings)
- Modify: `App/renderer/index.html`

- [ ] **Step 1: Log each step as chat message**

Nach jedem `executeToolCall`, result in die messages pushen:

```
// Audit trail
if (plan) {
  const auditMsg = { role: 'system', content: '[Step ' + _stepIndex + '/' + _totalSteps + '] Executed: ' + formatToolActivity(name, args) + '\nResult: ' + String(result).slice(0, 500) };
  chatHistory.push(auditMsg);
}
```

- [ ] **Step 2: Save agent mode preference to localStorage**

Im `sendMessage` nach dem Plan-Schritt:

```
localStorage.setItem('florde-agent-mode', document.getElementById('btn-agentic-mode')?.classList.contains('agentic-plan') ? 'plan' : 'build');
```

Beim Laden in `loadSettings()`:

```
const savedMode = localStorage.getItem('florde-agent-mode');
if (savedMode === 'build') {
  const btn = document.getElementById('btn-agentic-mode');
  if (btn && btn.classList.contains('agentic-plan')) btn.click();
}
```

- [ ] **Step 3: Verify syntax**

Run: `node -e "new Function(require('fs').readFileSync('App/renderer/script.js','utf8'))" && echo OK`
