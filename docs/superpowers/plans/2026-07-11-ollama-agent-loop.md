# Ollama Agent Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Ollama tool calling so models reliably use tools across all conversation turns by injecting a tool reminder before every request and enforcing single-tool-call-per-response discipline.

**Architecture:** A compact `buildToolReminder()` function generates a short tool-availability message injected before each model request in the sendMessage loop. Tool-call/result pairs are persisted to `chatHistory` for cross-turn memory. The loop accepts only ONE tool call per response, and code-instead-of-tools is detected and corrected.

**Tech Stack:** Vanilla JS in Electron renderer (`script.js`). No new dependencies.

**Files modified:** `App/renderer/script.js`

## Global Constraints

- All changes in `App/renderer/script.js` only
- Keep existing `getActiveTools()`, `executeToolCall()`, `getToolResultMsg()`, `buildSystemPrompt()` functions unchanged
- Maintain backward compatibility for non-Ollama providers
- No new files or dependencies
- All strings in German (user's language preference)

---

### Task 1: buildToolReminder function

**Files:**
- Modify: `App/renderer/script.js` (insert after `getActiveTools()` at ~line 197)

**Interfaces:**
- Produces: `buildToolReminder(tools)` → returns a short user-role message string

- [ ] **Step 1: Insert buildToolReminder after getActiveTools()**

Find this code at ~line 197:
```js
  return [...baseTools, ...appTools, ...pluginTools, ...mcpTools];
}

window.__updateTools = function() {
```

Replace with:
```js
  return [...baseTools, ...appTools, ...pluginTools, ...mcpTools];
}

function buildToolReminder() {
  const tools = getActiveTools();
  if (!tools || tools.length === 0) return 'Du hast keine Tools verfügbar.';
  const names = tools.map(t => t.function?.name).filter(Boolean);
  const lines = names.map(n => '- ' + n);
  return 'Du hast diese Tools:\n' + lines.join('\n') + '\n\nREgeln:\n- Wenn du ein Tool brauchst: antworte NUR mit dem Tool-Call (KEIN Text)\n- Wenn du fertig bist: antworte NUR mit Text (KEIN Tool-Call)\n- Du darfst mehrere Tools nacheinander benutzen, aber immer nur EINS pro Antwort';
}

window.__updateTools = function() {
```

- [ ] **Step 2: Verify syntax**

Run: `node -e "const fs=require('fs');new Function(fs.readFileSync('App/renderer/script.js','utf8'));console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add App/renderer/script.js
git commit -m "feat: add buildToolReminder function"
```

---

### Task 2: Inject tool reminder into sendMessage loop (native tools path)

**Files:**
- Modify: `App/renderer/script.js:4170-4246`

**Interfaces:**
- Consumes: `buildToolReminder()`, `getActiveTools()`, `executeToolCall(name, args)`, `getToolResultMsg(toolCallId, name, result)`, `_detectToolLoop(name, args)`
- Produces: tool-call/result pairs persisted in `chatHistory`

- [ ] **Step 1: Replace the native tools loop**

Find this code starting at line 4170:
```js
    if (supportsTools) {
      let toolRounds = 0;
      const maxRounds = 15;

      while (toolRounds < maxRounds) {
        const response = await fetchWithBackoff(() => prov.sendWithTools(messages, getActiveTools()));
        if (_timedOut) return;
        stopAnim();
        resetRequestTimeout(timeoutMinutes, onTimeout);

        if (response.tool_calls && response.tool_calls.length > 0) {
          // Limit native tool calls per round to 5 to prevent flooding
          const maxNativeToolsPerRound = 5;
          const toolCallsToProcess = response.tool_calls.slice(0, maxNativeToolsPerRound);
          if (response.tool_calls.length > maxNativeToolsPerRound) {
            logToTerminal('Too many tool calls (' + response.tool_calls.length + '), processing first ' + maxNativeToolsPerRound, 'warn');
          }
          messages.push({ role: 'assistant', content: response.content || null, tool_calls: toolCallsToProcess });
          logToTerminal('AI is using tools: ' + toolCallsToProcess.map(t => t.function.name).join(', '), 'ai');

          const toolNames = toolCallsToProcess.map(t => t.function.name).join(', ');
          startAnim('*Running tools', ' (' + toolNames + ')*');

          for (const toolCall of toolCallsToProcess) {
            const args = JSON.parse(toolCall.function.arguments || '{}');
            const name = toolCall.function.name;
            const loopMsg = _detectToolLoop(name, args);
            if (loopMsg) {
              messages.push(getToolResultMsg(toolCall.id, name, loopMsg));
              logToTerminal(loopMsg, 'warn');
              continue;
            }
            // Step tracking
            if (_planSteps) {
              _currentStep = Math.min(_currentStep + 1, _planSteps);
              const stepEl = document.getElementById('plan-step-progress');
              if (stepEl) stepEl.textContent = _currentStep + '/' + _planSteps;
              const aiMsg = document.querySelector('.chat-msg.ai:last-child');
              if (aiMsg) {
                const sd = document.createElement('div');
                sd.className = 'agent-step';
                sd.innerHTML = '<span class="agent-step-num">Step ' + _currentStep + '/' + _planSteps + '</span> <span class="agent-step-name">' + formatToolActivity(name, args) + '</span><span class="agent-step-bar"><span class="agent-step-progress" style="width:' + (_currentStep / _planSteps * 100) + '%"></span></span>';
                aiMsg.appendChild(sd);
              }
            }
            stopAnim('*' + formatToolActivity(name, args) + '*');
            let result;
            try {
              result = await executeToolCall(name, args);
            } catch (err) {
              result = 'Error: ' + err.message;
            }
            messages.push(getToolResultMsg(toolCall.id, name, result));
            // Audit trail
            if (_planSteps) {
              chatHistory.push({ role: 'system', content: '[Step ' + _currentStep + '/' + _planSteps + '] Executed: ' + formatToolActivity(name, args) + '\nResult: ' + String(result).slice(0, 500) });
            }
            startAnim('*Running tools', ' (' + toolNames + ')*');
            resetRequestTimeout(timeoutMinutes, onTimeout);
          }
          stopAnim();
          toolRounds++;
          startAnim('*Waiting for AI*');
        } else {
          finalContent = response.content || '';
          break;
        }
      }

      if (toolRounds >= maxRounds) {
        contentDiv.textContent = 'Tool call limit reached. Please try a simpler request.';
        logToTerminal('Tool call limit reached (max ' + maxRounds + ' rounds)', 'error');
        clearActivity();
        clearRequestTimeout();
        return;
      }
    }
```

Replace with:
```js
    if (supportsTools) {
      let toolRounds = 0;
      const maxRounds = 15;

      while (toolRounds < maxRounds) {
        // Inject tool reminder before each model request
        const reminder = { role: 'user', content: buildToolReminder() };
        const msgsWithReminder = [reminder, ...messages];

        const response = await fetchWithBackoff(() => prov.sendWithTools(msgsWithReminder, getActiveTools()));
        if (_timedOut) return;
        stopAnim();
        resetRequestTimeout(timeoutMinutes, onTimeout);

        if (response.tool_calls && response.tool_calls.length > 0) {
          // Nur EINEN Tool-Call pro Runde akzeptieren
          const toolCall = response.tool_calls[0];
          const args = JSON.parse(toolCall.function.arguments || '{}');
          const name = toolCall.function.name;

          // Prüfen ob der Tool-Call + Text gemischt ist
          const hasText = response.content && response.content.trim().length > 0;
          if (hasText) {
            // Model hat Text + Tool-Call gemischt → darauf hinweisen
            messages.push({ role: 'assistant', content: response.content });
            messages.push({ role: 'user', content: 'Bitte sende NUR den Tool-Call oder NUR Text, nicht beides. Wenn du ein Tool brauchst, antworte nur mit dem Tool-Call (kein Text).' });
            toolRounds++;
            startAnim('*Waiting for AI*');
            continue;
          }

          const loopMsg = _detectToolLoop(name, args);
          if (loopMsg) {
            messages.push({ role: 'assistant', content: null, tool_calls: [toolCall] });
            messages.push(getToolResultMsg(toolCall.id, name, loopMsg));
            logToTerminal(loopMsg, 'warn');
            // In chatHistory speichern
            chatHistory.push({ role: 'system', content: '[Tool] ' + name + ' → Loop detected' });
            toolRounds++;
            startAnim('*Waiting for AI*');
            continue;
          }

          messages.push({ role: 'assistant', content: null, tool_calls: [toolCall] });
          logToTerminal('AI uses tool: ' + name, 'ai');
          startAnim('*Running tool: ' + name + '*');

          // Step tracking
          if (_planSteps) {
            _currentStep = Math.min(_currentStep + 1, _planSteps);
            const stepEl = document.getElementById('plan-step-progress');
            if (stepEl) stepEl.textContent = _currentStep + '/' + _planSteps;
            const aiMsg = document.querySelector('.chat-msg.ai:last-child');
            if (aiMsg) {
              const sd = document.createElement('div');
              sd.className = 'agent-step';
              sd.innerHTML = '<span class="agent-step-num">Step ' + _currentStep + '/' + _planSteps + '</span> <span class="agent-step-name">' + formatToolActivity(name, args) + '</span><span class="agent-step-bar"><span class="agent-step-progress" style="width:' + (_currentStep / _planSteps * 100) + '%"></span></span>';
              aiMsg.appendChild(sd);
            }
          }

          stopAnim('*' + formatToolActivity(name, args) + '*');
          let result;
          try {
            result = await executeToolCall(name, args);
          } catch (err) {
            result = 'Error: ' + err.message;
          }
          messages.push(getToolResultMsg(toolCall.id, name, result));

          // Tool-Call-Paar in chatHistory speichern für Cross-Turn-Memory
          chatHistory.push({ role: 'assistant', content: null, tool_calls: [toolCall], model: provider });
          chatHistory.push(getToolResultMsg(toolCall.id, name, String(result).slice(0, 1000)));
          trimChatHistory();

          toolRounds++;
          startAnim('*Waiting for AI*');
        } else {
          finalContent = response.content || '';
          break;
        }
      }

      if (toolRounds >= maxRounds) {
        contentDiv.textContent = 'Tool call limit reached. Please try a simpler request.';
        logToTerminal('Tool call limit reached (max ' + maxRounds + ' rounds)', 'error');
        clearActivity();
        clearRequestTimeout();
        return;
      }
    }
```

- [ ] **Step 2: Verify syntax**

Run: `node -e "const fs=require('fs');new Function(fs.readFileSync('App/renderer/script.js','utf8'));console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add App/renderer/script.js
git commit -m "feat: tool-reminder vor jedem Model-Request + single tool call + history persist"
```

---

### Task 3: Code-instead-of-tool enforcement

**Files:**
- Modify: `App/renderer/script.js` (in the native tools loop, after the `else` branch)

- [ ] **Step 1: Add code detection after receiving text response**

After the `finalContent = response.content || '';` line in the else branch (native tools path), add enforcement:

Find:
```js
        } else {
          finalContent = response.content || '';
          break;
        }
```

Replace with:
```js
        } else {
          const text = response.content || '';
          // Prüfen ob Code-Blöcke ohne Tool-Call ausgegeben werden
          const hasCodeBlock = /```[\s\S]*?```/.test(text);
          const hasWriteLike = /\bwrite_file\b|\bedit_file\b|\bcreate\b.*\bfile\b/i.test(text);
          if (hasCodeBlock && !text.includes('tool_calls')) {
            messages.push({ role: 'assistant', content: text });
            messages.push({ role: 'user', content: 'Du hast Code in der Chat-Antwort ausgegeben, statt write_file/edit_file zu benutzen. Bitte benutze das entsprechende Tool, um die Datei zu schreiben oder zu bearbeiten. Danach kannst du deine Antwort als Text geben.' });
            toolRounds++;
            startAnim('*Waiting for AI*');
            continue;
          }
          finalContent = text;
          break;
        }
```

- [ ] **Step 2: Verify syntax**

Run: `node -e "const fs=require('fs');new Function(fs.readFileSync('App/renderer/script.js','utf8'));console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add App/renderer/script.js
git commit -m "feat: enforce tool-use when model outputs code blocks"
```

---

### Task 4: Update text-based tool fallback path (non-tool models)

**Files:**
- Modify: `App/renderer/script.js:4247-4336`

- [ ] **Step 1: Add reminder to text tool fallback path**

Find the text-based tool loop (after the `supportsTools` if-block's closing brace):

```js
    } else {
      let toolRounds = 0;
      const maxRounds = 15;

      while (toolRounds < maxRounds) {
        finalContent = await fetchWithBackoff(() => prov.sendMessage(messages, (chunk) => {
```

Insert reminder injection before `finalContent = await fetchWithBackoff(...)`:
```js
    } else {
      let toolRounds = 0;
      const maxRounds = 15;

      while (toolRounds < maxRounds) {
        // Tool reminder für nicht-nativen Tool-Use
        const reminder = { role: 'user', content: buildToolReminder() };
        const msgsWithReminder = [reminder, ...messages];

        finalContent = await fetchWithBackoff(() => prov.sendMessage(msgsWithReminder, (chunk) => {
```

- [ ] **Step 2: Verify syntax**

Run: `node -e "const fs=require('fs');new Function(fs.readFileSync('App/renderer/script.js','utf8'));console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add App/renderer/script.js
git commit -m "feat: add tool reminder to text-based tool fallback path"
```

---

### Task 5: Parallel tool execution for splash (optional, if current code does parallel)

**Files:**
- Modify: `App/renderer/script.js`

No changes needed — the existing `toolCallsToProcess.slice(0, maxNativeToolsPerRound)` and the for-loop already handle sequential execution. The new code processes exactly 1 tool call per round so no parallel/sequential concern exists.

- [ ] **Step 1: Confirm no changes needed** — the single-tool-call-per-round approach inherently serializes execution. Skip.

---

### Task 6: Final verification

- [ ] **Step 1: Run full syntax check**

```bash
node -e "const fs=require('fs');new Function(fs.readFileSync('App/renderer/script.js','utf8'));console.log('OK')"
```

- [ ] **Step 2: Review git diff**

```bash
git diff --stat
```

Expected: Only `App/renderer/script.js` modified with ~50-80 lines changed.

- [ ] **Step 3: Commit any final adjustments**

```bash
git add App/renderer/script.js
git commit -m "feat: ollama agent loop — tool reminder, single call, history persist, code enforcement"
```
