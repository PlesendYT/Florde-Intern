# Florde Loop Detection — Implementation Plan

## Overview

Three-phase implementation of the Loop Detection system for Florde agents.

**Files to create:**
- `App/renderer/tools/loop-detector.js` — Core detection engine
- `App/renderer/tools/recovery-manager.js` — Recovery strategies and state

**Files to modify:**
- `App/renderer/script.js` — Integrate into tool loop + settings
- `App/renderer/subagents.js` — Per-subagent LoopDetector instances
- `App/renderer/index.html` — Settings UI + loop warning UI + script tag
- `App/renderer/style.css` — Loop status styles

---

## Phase 1 — MVP

**Goal:** Core loop detection with user controls and basic recovery.

### Step 1.1: Action History & Fingerprinting

**Create** `App/renderer/tools/loop-detector.js`

```
window.LoopDetector = class LoopDetector {
  constructor(agentId)
  
  // Action tracking
  recordAction(event)         — Add ActionEvent to history
  
  // Fingerprinting
  _fingerprintTool(name, args, result)  — Generate tool call signature
  _fingerprintError(result)             — Normalize error to fingerprint
  _fingerprintResult(result)            — Normalize test/build output
  
  // History
  _history: ActionEvent[]     — Last 50 events
  _metrics: { testsFailed, testsPassed, buildSuccess, ... }
  
  // Analysis
  analyze() → { score, status, type, details }
  _detectExactLoop() → score contribution
  _detectErrorLoop() → score contribution
  _computeScore(signals) → 0.0–1.0
  
  // State
  getStatus() → 'normal' | 'possible' | 'confirmed' | 'critical'
  getLoopHistory() → past loop events
  reset()                     — Clear history (after successful recovery)
}
```

**Integration:**
- Instantiate once per agent (main + each subagent gets its own)
- Call `recordAction()` after every `executeToolCall()` return
- Call `analyze()` at the end of each tool round

### Step 1.2: Integrate into Main Tool Loop

**Modify** `App/renderer/script.js` — `sendMessage()` function

**Location:** After tool execution (line ~5866)

```js
// After: result = await executeToolCall(name, args);
// Add:
loopDetector.recordAction({
  timestamp: Date.now(),
  agentId: 'main',
  type: inferActionType(name),  // 'tool_call', 'command', 'file_edit', etc.
  tool: name,
  command: args.command,
  file: args.file || args.path,
  result: String(result).slice(0, 500),
  resultHash: loopDetector._fingerprintResult(result),
  success: !String(result).startsWith('Error:'),
  errorFingerprint: String(result).startsWith('Error:') ? loopDetector._fingerprintError(result) : null,
});
```

**Location:** After each tool round completes (after `toolRounds++`)

```js
const loopAnalysis = loopDetector.analyze();
if (loopAnalysis.score >= 0.50) {
  // Confirmed or Critical loop
  await handleLoopDetection(loopAnalysis);
}
```

### Step 1.3: Integrate into Subagent Loop

**Modify** `App/renderer/tools/subagents.js` — `SubagentInstance` class

```js
// In constructor:
this._loopDetector = new LoopDetector(this.id);

// In _runConversation(), after executeToolCall:
this._loopDetector.recordAction({ ... });

// After each turn:
const analysis = this._loopDetector.analyze();
if (analysis.score >= 0.50) {
  this._onChunk?.('loop', analysis);
}
```

### Step 1.4: Recovery Manager

**Create** `App/renderer/tools/recovery-manager.js`

```
window.RecoveryManager = class RecoveryManager {
  constructor(loopDetector)
  
  // State
  _recoveryAttempts: number   — 0–3
  _maxAttempts: number        — Default 3
  _lastStrategy: string       — Track to avoid repeating
  
  // Recovery
  attemptRecovery(loopAnalysis) → strategy
  _selectStrategy(analysis, history) → string
  checkRecoveryProgress(before, after) → boolean
  
  // Auto-recovery
  _autoRecoveryEnabled: boolean
  _recoveryDelay: number      — ms, default 120000
  scheduleAutoRecovery(analysis)
  
  // Reset
  resetCounter()              — On successful recovery
  
  // Strategies
  STRATEGIES = [
    're-evaluate',     — Re-analyze the goal
    'inspect-failure', — Examine error without changing code
    'review-changes',  — Review recent modifications
    'alternative',     — Choose different approach
    'sub-agent',       — Delegate analysis to another agent
  ]
}
```

### Step 1.5: Loop Warning UI

**Modify** `App/renderer/script.js` — Add `handleLoopDetection(analysis)`

```js
async function handleLoopDetection(analysis) {
  const status = analysis.status; // 'possible' | 'confirmed' | 'critical'
  
  if (status === 'possible') {
    // Subtle indicator, no modal
    updateLoopIndicator('possible', analysis);
    return;
  }
  
  if (status === 'confirmed') {
    // Show warning modal with options
    const action = await showLoopWarningModal(analysis);
    // action: 'pause' | 'retry' | 'continue'
    
    if (action === 'pause') {
      _stoppedByUser = true;
    } else if (action === 'retry') {
      const strategy = recoveryManager.attemptRecovery(analysis);
      injectRecoveryPrompt(strategy);
    }
    // 'continue' → just keep going
  }
  
  if (status === 'critical') {
    // Stop agent
    _stoppedByUser = true;
    showCriticalLoopMessage(analysis);
  }
}
```

**UI Elements to add:**

1. **Loop indicator badge** in chat toolbar (next to plan step progress)
2. **Loop warning modal** with Pause/Retry/Continue buttons
3. **Loop history panel** in agent details

### Step 1.6: Settings Integration

**Modify** `App/renderer/script.js` — Settings section

Add to `florde-settings`:
```js
loopDetection: {
  enabled: true,
  sensitivity: 'balanced',  // 'conservative' | 'balanced' | 'aggressive'
  showPossibleWarning: true,
  askBeforeRecovery: true,
  autoRecovery: true,
  recoveryDelay: 120000,    // 2 minutes
  maxRecoveryAttempts: 3,
  stopOnCritical: true,
  disableRabbitHole: false,
  disableContextLoop: false,
  disableRevertLoop: false,
}
```

**Modify** `App/renderer/index.html` — Add settings UI in Agents tab

### Step 1.7: Replace Existing `_detectToolLoop`

**Modify** `App/renderer/script.js` — Remove closure-based `_detectToolLoop` (lines 5796–5809)

Replace with calls to `LoopDetector` instance. Remove `_toolCallHistory` array.

---

## Phase 2 — Advanced Detection

**Goal:** Revert loops, context loops, git state tracking, recovery strategies.

### Step 2.1: Revert Loop Detection

**Add to** `LoopDetector`:

- Track file content hashes before/after edits
- Detect when a file returns to a previous hash state
- Score: +0.15 when revert pattern detected

**Implementation:**
- In `recordAction()` for `file_edit`/`write_file`: compute content hash
- Maintain `_fileStateHistory: Map<filename, hash[]>`
- Check if current hash matches any previous hash

### Step 2.2: Context Loop Detection

**Add to** `LoopDetector`:

- Detect context compaction events in chat history
- Compare agent actions before/after compaction
- Flag if same files targeted, same errors encountered

**Implementation:**
- Listen for `[Summary]` or context compaction system messages
- Store `_preCompactionActions` snapshot
- Compare with `_postCompactionActions`

### Step 2.3: Git State Tracking

**Add to** `LoopDetector`:

- After git operations, capture `git diff --stat` output
- Track commit/diff size over time
- Detect oscillating diffs (changes revert to previous state)

**Implementation:**
- New action type: `'git'`
- Capture diff stats as state fingerprint
- Compare current diff against history

### Step 2.4: Enhanced Error Normalization

**Improve** `_fingerprintError()`:

- Strip line numbers more aggressively
- Normalize stack traces
- Handle multi-line errors
- Extract error type + message pattern

### Step 2.5: Recovery Strategies

**Implement all 5 strategies** in `RecoveryManager`:

1. **Re-evaluate:** Inject system message: "Re-evaluate the task. Determine why previous approach failed."
2. **Inspect Failure:** Inject system message: "Do NOT modify code. Only examine and report on the current error."
3. **Review Changes:** Inject system message: "Review your recent changes. Are they correct? What might be wrong?"
4. **Alternative:** Inject system message: "Choose a fundamentally different approach. The current strategy is not working."
5. **Sub-Agent:** Spawn a review subagent to analyze the current state.

### Step 2.6: Automatic Recovery

**Implement** in `RecoveryManager`:

- Configurable delay (30s–10min)
- Strategy rotation (don't repeat same strategy)
- Progress check after recovery attempt
- Counter management (reset on success, increment on failure)

### Step 2.7: Loop History Persistence

**Store** loop events in session:

- Each loop detection event saved to `chatHistory` as system message
- Format: `[Loop] 13:42 Possible Loop — Error Loop — Score: 0.65`
- Displayable in agent details panel

---

## Phase 3 — Advanced Features

**Goal:** Rabbit hole detection, task relevance, adaptive scores, multi-agent global detection.

### Step 3.1: Rabbit Hole Detection

**Add to** `LoopDetector`:

- Extract task goal from initial user message
- Compute task relevance score for each action
- Track files changed vs. task-relevant files
- Detect drift: many actions with decreasing relevance

**Signals:**
- Files changed that are unrelated to task
- Tools used that diverge from task type
- Time elapsed without milestone
- Number of unrelated files changed

### Step 3.2: Task Relevance Analysis

**Add to** `LoopDetector`:

- Parse task description for keywords/files
- Maintain `_taskContext: { goal, relevantFiles, relevantPatterns }`
- Score each action against task context

**Implementation:**
- Extract file paths mentioned in task
- Extract keywords (e.g., "fix login" → login-related files)
- Compare action targets against task context

### Step 3.3: Adaptive Loop Scores

**Improve** score calculation:

- Weights adjust based on sensitivity level
- Historical data informs thresholds
- Per-provider calibration (some providers are more prone to loops)

### Step 3.4: Multi-Agent Global Detection

**Add** global task loop detection:

- Aggregate loop signals across all agents
- If multiple agents hit same error → global loop
- Main agent monitors subagent health
- Per-agent pause without stopping others

**Implementation:**
- Global `LoopDetector` instance for the main agent
- Subagent instances report to global detector
- Global detector aggregates signals

### Step 3.5: Intelligent Recovery Selection

**Improve** `RecoveryManager._selectStrategy()`:

- Use history to avoid repeating failed strategies
- Prefer strategies that worked in similar situations
- Consider which loop type was detected

### Step 3.6: Long-term Agent State Analysis

**Add** session-level analysis:

- Track loop frequency across session
- Identify recurring patterns
- Suggest strategy changes based on history

---

## Dependency Order

```
Phase 1:
  1.1 → 1.2 → 1.4 → 1.5 → 1.6 → 1.7
  1.3 can be done in parallel with 1.2

Phase 2:
  2.1, 2.2, 2.3, 2.4 can be done in parallel
  2.5, 2.6 depend on 2.1–2.4
  2.7 can be done in parallel with 2.5–2.6

Phase 3:
  3.1, 3.2 can be done in parallel
  3.3 depends on 3.1–3.2
  3.4, 3.5, 3.6 can be done in parallel
```

---

## Testing Strategy

### Unit Tests
- LoopDetector fingerprinting functions
- Score calculation with known inputs
- Recovery strategy selection

### Integration Tests
- Exact loop scenario: repeat same tool call → detect
- Error loop scenario: different fixes, same error → detect
- Normal operation: varied successful actions → no false positive
- Recovery flow: detect → recover → progress → reset counter

### Manual Test Scenarios
1. Agent editing same file repeatedly without fixing tests
2. Agent running tests that always fail with same error
3. Agent successfully progressing through multiple fixes
4. Subagent stuck in loop while main agent works fine
5. Context compaction followed by re-analysis of same problem
