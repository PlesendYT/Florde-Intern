# Full App Bug Hunt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Systematischer Review der gesamten App auf bugs, edge cases, security issues und UX-Probleme.

**Architecture:** Jedes Modul wird systematisch durchgegangen. Bugs werden dokumentiert und gefixt.

**Tech Stack:** Electron, vanilla JS

## Global Constraints
- Kein Build-Step, keine externen Dependencies
- Jeder Bug braucht Root Cause + Fix
- Kritische Bugs sofort fixen, kosmetische gesammelt

---

### Task 1: script.js — Static Analysis (Uncaught Errors, Race Conditions, Scope)

**Files:**
- Review: `App/renderer/script.js` (komplett)

- [ ] **Step 1: Scan for try/catch gaps in async functions**

Check every `async function` that calls `await` on external operations (fetch, electronAPI, FileReader). Ensure try/catch covers all await calls. Pay special attention to `sendMessage`, `executeToolCall`, event handlers.

Fix pattern:
```
try {
  const result = await riskyOperation();
} catch (err) {
  logToTerminal('Operation failed: ' + err.message, 'error');
  // Fallback / cleanup
}
```

- [ ] **Step 2: Scan for const/let in switch cases without block scope**

Check `executeToolCall` switch statement for `const`/`let` declarations at case level that might conflict. Each `case` needs `{ }` if it contains block-scoped declarations that share names with other cases.

- [ ] **Step 3: Check for DOM element existence before access**

Scan all `document.getElementById(...)`, `document.querySelector(...)` calls that might return null. Common pattern to fix:
```
const el = document.getElementById('some-id');
if (!el) return; // or el?.method()
```

- [ ] **Step 4: Check for potential XSS in innerHTML assignments**

Scan all `.innerHTML =` assignments that include user or model-generated content. Ensure `escapeHtml()` is used for untrusted data (model names, file contents, user input).

Check per line:
- Message rendering (`formatMessageContent`)
- Plan modal
- File tree rendering
- Connected apps grid
- Model list items

- [ ] **Step 5: Verify setInterval/clearInterval pairing**

Ensure every `setInterval` has a corresponding `clearInterval` on cleanup / unmount. Check `startAnim` interval.

- [ ] **Step 6: Check addEventListener memory leaks**

Scan for `addEventListener` on DOM elements that might be repeatedly created/destroyed (modals, overlays, tooltips). Ensure listeners are removed or use `{ once: true }`.

---

### Task 2: script.js — Data Flow & Edge Cases

**Files:**
- Review: `App/renderer/script.js`

- [ ] **Step 1: Test empty/undefined args in executeToolCall**

Every tool handler in the switch should handle `args.path`, `args.content`, `args.command` being undefined/null/empty:
- `read_file`: path undefined
- `write_file`: content undefined
- `exec_command`: command undefined
- `rename_file`: path/newPath undefined

- [ ] **Step 2: Check for NaN in numeric operations**

Scan for `parseInt`, `parseFloat`, `.toFixed()`, arithmetic operations where the input might be undefined:
- Temperature parsing
- Timeout parsing
- Token calculations
- Progress percentages

- [ ] **Step 3: Verify provider state when switching**

When provider is switched mid-request or settings change during an active request:
- Is `_isRequestActive` checked?
- Are pending requests aborted?
- Are timeouts cleared?

- [ ] **Step 4: Test empty chat history**

When `sendMessage` is called with `chatHistory = []`, does the system prompt still work? Does `buildVisionMessages` handle empty arrays?

- [ ] **Step 5: Verify escapeHtml in all user-visible model names**

The free badge, model info popup, settings selects — all display model names. Ensure all are escaped.

---

### Task 3: index.html — DOM Bugs

**Files:**
- Review: `App/renderer/index.html`

- [ ] **Step 1: Check for duplicate element IDs**

Scan for duplicate `id` attributes across the HTML. Each id must be unique.

- [ ] **Step 2: Verify form element associations**

Check that every `<label>` is properly associated with its `<input>`/`<select>` (either via `for` attribute or wrapping).

- [ ] **Step 3: Check for missing semantic structure**

Scan for:
- Missing `<main>`, `<nav>`, `<section>` landmarks
- Unclosed tags
- Invalid nesting (e.g., `<div>` inside `<p>`)

- [ ] **Step 4: Verify tab order / keyboard navigation**

Check that interactive elements (buttons, inputs, selects) appear in logical tab order. Modal elements should trap focus.

---

### Task 4: style.css — Layout & State Bugs

**Files:**
- Review: `App/renderer/style.css`

- [ ] **Step 1: Check for missing states**

Every interactive element should have `:hover`, `:focus`, `:active`, `:disabled` states. Check:
- Buttons
- Inputs, selects
- Modal overlays
- Dropdown lists

- [ ] **Step 2: Verify z-index layering**

Scan z-index values:
- Modal overlay: 10000
- Permission prompt: 10000
- Model info popup: ?
- Dropdown lists: ?
If any overlap, document the conflict.

- [ ] **Step 3: Check for overflow/scroll issues**

Long model names, long file paths, long tool output should not break layout. Check `text-overflow: ellipsis` usage.

- [ ] **Step 4: Verify CSS variable usage**

Scan for hardcoded colors that should use `var(--text)`, `var(--bg2)`, etc.

---

### Task 5: preload.js & main.js — IPC & Security

**Files:**
- Review: `App/preload.js`
- Review: `App/main.js`

- [ ] **Step 1: Check contextIsolation / nodeIntegration**

Verify `main.js` has `contextIsolation: true` and `nodeIntegration: false` for security.

- [ ] **Step 2: Check exposed APIs in preload**

Verify no dangerous APIs are exposed via `contextBridge`. All exposed functions should have parameter validation.

- [ ] **Step 3: Check for unhandled promise rejections in IPC**

Every `ipcMain.handle` should have try/catch and return `{ error }` on failure.

- [ ] **Step 4: Verify CSP headers**

Check if Content-Security-Policy is set in `main.js` to prevent XSS.

---

### Task 6: Integration Bug Fixes

**Files:**
- Modify: `App/renderer/script.js`
- Modify: `App/renderer/style.css`

- [ ] **Step 1: Fix all discovered bugs**

For each confirmed bug from Tasks 1-5, apply the fix in order of severity:
1. Critical (app crash, data loss)
2. High (incorrect behavior, broken feature)
3. Medium (cosmetic, edge case)
4. Low (style, consistency)

- [ ] **Step 2: Verify each fix**

After each fix, run:
```
node -e "new Function(require('fs').readFileSync('App/renderer/script.js','utf8'))" && echo OK
```

- [ ] **Step 3: Commit fixes**

```
git add -A && git commit -m "bugfix: [description of fixes]"
```
