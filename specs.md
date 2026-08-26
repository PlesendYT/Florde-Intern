# Florde Loop Detection — Technical Specification

## 1. Overview

Loop Detection is a monitoring system for Florde agents that detects when an agent is no longer making meaningful progress toward its goal. It does **not** use primitive counters (e.g., "N tool calls → stop"). Instead, it analyzes behavioral patterns and measurable state changes.

**Core question:** *"Is the agent making measurable progress toward its goal?"*

---

## 2. Architecture

```
Agent
  ↓
Tool Execution
  ↓
Action Event
  ↓
Action History
  ↓
Loop Detection Engine
  ↓
Loop Analysis
  ↓
Loop State
  ↓
Recovery Manager
  ↓
UI
```

### 2.1 File Structure

```
App/renderer/
  tools/
    loop-detector.js    — LoopDetector class (core engine)
    recovery-manager.js — RecoveryManager class (strategies, state)
```

Both modules expose classes on `window` for access from `script.js` and `subagents.js`.

### 2.2 Integration Points

| Integration | Location | Description |
|---|---|---|
| Tool dispatch | `executeToolCall()` line 4665 | Wrap to capture action events |
| Main tool loop | `sendMessage()` line 5811 | Feed events to LoopDetector, read loop state |
| Subagent loop | `SubagentInstance._runConversation()` line 62 | Same integration, per-subagent LoopDetector instance |
| Chat history injection | Lines 5843, 5968 | Loop status messages |
| Settings | `florde-settings` localStorage | Configuration persistence |
| UI | Chat toolbar + agent detail modal | Status display + recovery controls |

---

## 3. Action Events

Every agent action produces an Action Event that feeds into the history.

### 3.1 Event Schema

```typescript
interface ActionEvent {
  timestamp: number;
  agentId: string;           // "main" or "sub-N"
  type: 'tool_call' | 'file_edit' | 'file_read' | 'command' | 'search' |
        'browser' | 'mcp_call' | 'subagent_call' | 'build' | 'test' | 'git';
  tool?: string;             // tool name
  command?: string;          // for exec_command
  file?: string;             // for file operations
  args?: object;             // relevant arguments
  result?: string;           // tool output (truncated)
  resultHash?: string;       // normalized fingerprint of result
  filesChanged?: string[];   // files modified by this action
  success?: boolean;         // whether the action succeeded
  errorFingerprint?: string; // normalized error signature
}
```

### 3.2 Event Collection

- **Per-agent:** Each agent (main + each subagent) maintains its own `ActionHistory`
- **Windowed:** Only the last 50 events are kept in memory for active analysis
- **Session persistence:** Loop history events are stored in the session's `chatHistory` as system messages

---

## 4. Action Fingerprints

Fingerprints normalize actions for comparison, ignoring irrelevant differences.

### 4.1 Tool Call Fingerprint

```
signature = tool_name + ':' + normalized_args
```

Normalization:
- Strip line numbers from file paths in args
- Hash file contents (not raw strings)
- Truncate command output to first 200 chars before hashing

### 4.2 Error Fingerprint

```
errorType :: normalizedMessage :: relevantFile
```

Example:
```
TypeError::CannotReadUndefined::src/auth.ts
```

Normalization:
- Strip line numbers: `Error at line 42` → `Error at line *`
- Strip variable names: `Cannot read property 'x'` → `Cannot read property '*'`
- Keep file path and error type

### 4.3 Result Fingerprint

For tool results (especially test output):
- Extract structured data (test pass/fail counts, error messages)
- Hash the normalized structure
- Ignore timestamps, random values, exact line numbers

---

## 5. Progress Tracking

### 5.1 Metrics Tracked

| Metric | Source | How Measured |
|---|---|---|
| `testsPassed` | exec_command output | Parse "X passed" patterns |
| `testsFailed` | exec_command output | Parse "X failed" patterns |
| `buildSuccess` | exec_command output | Check exit code / success patterns |
| `lintErrors` | exec_command output | Parse lint output |
| `typeErrors` | exec_command output | Parse tsc/compiler output |
| `filesChanged` | file_edit/write_file | Track modified files |
| `errorFingerprint` | tool results | Current active error signature |
| `toolFailureRate` | action history | failed / total tool calls |
| `gitDiffSize` | git operations | Lines changed |

### 5.2 Progress Calculation

Progress is measured as the **delta** between states:

```
progress = metrics_before vs metrics_after
```

A state is a snapshot of all metrics at a point in time. Progress exists when:
- `testsFailed` decreases
- `buildSuccess` changes from false → true
- `errorFingerprint` changes (different error = potential progress)
- New files are created or existing files are meaningfully modified

**No progress** when:
- Metrics remain identical across multiple action cycles
- Error fingerprint repeats
- Files are modified but error count stays the same

---

## 6. Loop Types

### 6.1 Exact Loop

**Pattern:** Same action signature repeats.

**Detection:**
- Same `tool:args` fingerprint appears 3+ times
- Or: In last 5 calls, ≤ 2 unique signatures

**Score contribution:** +0.20

### 6.2 Error Loop

**Pattern:** Different actions, same error outcome.

**Detection:**
- Error fingerprint repeats 3+ times
- No metric improvement between attempts
- Different file edits leading to same test/build failure

**Score contribution:** +0.25

### 6.3 Revert Loop

**Pattern:** Agent oscillates between states.

**Detection:**
- File content hash returns to a previous state
- Same files edited back and forth
- Git diff shows alternating changes

**Score contribution:** +0.15

### 6.4 Context Loop

**Pattern:** After context compaction, agent re-analyzes the same problem.

**Detection:**
- Context compaction event detected in chat history
- Agent actions after compaction mirror actions before compaction
- Same files targeted, same errors encountered

**Score contribution:** +0.15

### 6.5 Rabbit Hole

**Pattern:** Agent works actively but drifts from the original goal.

**Detection:**
- Task relevance score decreasing over time
- Files changed are unrelated to original task
- No milestone reached despite many actions
- Tool usage diversifies away from core task

**Score contribution:** +0.20

---

## 7. Loop Score

The Loop Score is a continuous value from 0.00 to 1.00, calculated from weighted signals.

### 7.1 Score Ranges

| Range | Status | Behavior |
|---|---|---|
| 0.00 – 0.29 | Normal | No action |
| 0.30 – 0.49 | Possible Loop | Internal marker, optional subtle UI indicator |
| 0.50 – 0.74 | Confirmed Loop | Notify user, offer recovery options |
| 0.75 – 1.00 | Critical Loop | Stop agent after failed recovery |

### 7.2 Score Calculation

```
loopScore = clamp(0, 1,
  sameActions           * 0.20 +
  sameError             * 0.25 +
  noTestImprovement     * 0.20 +
  repeatedFileChanges   * 0.10 +
  revertBehavior        * 0.15 +
  contextRepetition     * 0.15 +
  goalDistanceIncrease   * 0.20
)
```

Each factor is normalized to 0.0–1.0. Weights are configurable per sensitivity level.

### 7.3 Sensitivity Levels

| Level | Behavior | Use Case |
|---|---|---|
| Conservative | Higher thresholds, fewer warnings | Long autonomous sessions |
| Balanced | Default weights as above | General use |
| Aggressive | Lower thresholds, earlier warnings | Token-cost-sensitive sessions |

---

## 8. Recovery System

### 8.1 Recovery States

```
Loop detected
     ↓
Notify user
     ↓
Offer recovery
     ↓
┌──────────────┬──────────────┬──────────────┐
│ Pause        │ Retry        │ Continue     │
└──────────────┴──────────────┴──────────────┘
```

### 8.2 Recovery Strategies

| Strategy | Description |
|---|---|
| Re-evaluate | Agent re-analyzes the original goal and why previous approach failed |
| Inspect Failure | Agent examines the current error without making changes |
| Review Changes | Agent reviews its own recent modifications |
| Alternative Approach | Agent chooses a fundamentally different strategy |
| Sub-Agent Review | A separate agent analyzes the current state |

### 8.3 Recovery Counter

- Tracks failed recovery attempts: `0 / 3`
- Resets to `0` when progress is detected after recovery
- Increments on each failed recovery
- After 3 failures → Critical Loop → Agent stopped

### 8.4 Automatic Recovery

Configurable:
- **Delay:** 30s, 1min, 2min (default), 5min, 10min, custom, or never
- **Max attempts:** 3 (default)
- **Strategy selection:**轮换 through available strategies

---

## 9. UI Specification

### 9.1 Status Indicators

| State | Indicator |
|---|---|
| Normal | `🟢 Working` |
| Possible Loop | `🟡 Possible loop` |
| Confirmed Loop | `🟠 Loop detected` |
| Critical Loop | `🔴 Critical loop` |

### 9.2 Loop Warning Modal

```
⚠ Loop detected

Florde detected that the agent has made
little or no measurable progress.

Reason:
The same test failure occurred 4 times.

Type: Error Loop
Confidence: 87%

Time: 11m 42s
Estimated tokens: 184k

Recovery attempts: 0 / 3

[Pause Agent]  [Retry]  [Continue]
```

### 9.3 Loop History

Displayed in agent details:

```
Loop History

13:42  Possible Loop    Error Loop
13:44  Confirmed Loop   Recovery started
13:46  Recovery successful
14:01  Possible Loop    Rabbit Hole
14:03  Confirmed Loop   Recovery started
```

---

## 10. Settings

```
Settings → Agents → Loop Detection

[✓] Enable Loop Detection
Detection sensitivity: [ Balanced ▼ ]
Possible Loop:  [✓] Show warning
Confirmed Loop: [✓] Ask before recovery
Automatic recovery: [✓]
Recovery delay: [ 2 minutes ]
Max recovery attempts: [ 3 ]
Critical Loop: [✓] Stop agent after failed recovery attempts

[ ] Disable Rabbit Hole Detection
[ ] Disable Context Loop Detection
[ ] Disable Revert Loop Detection
```

---

## 11. Multi-Agent Support

### 11.1 Per-Agent Detection

Each agent (main + subagents) has its own LoopDetector instance:
- Own action history
- Own loop score
- Own recovery counter

### 11.2 Global Task Loop Detection

Aggregates loop signals across all agents:
- If multiple agents hit the same error → global loop signal
- Main agent monitors subagent health
- User can pause individual agents without stopping others

### 11.3 Agent-Independent Design

Loop Detection operates on the Action Event stream, not on the AI model. This means:
- Works with any provider (OpenAI, Ollama, local, etc.)
- Works with subagents using different providers
- No dependency on specific model behavior

---

## 12. Performance Constraints

- Analysis window: last 20–50 actions for local patterns
- Fingerprint caching: computed once, reused
- Incremental metrics: only compute deltas, not full re-analysis
- No blocking: analysis runs asynchronously after tool execution
- Memory: ActionEvent array capped at 50 entries per agent

---

## 13. Security

- Loop Detection never executes actions independently
- Recovery attempts do not escalate permissions
- Agent permission boundaries remain unchanged during recovery
- No external API calls for loop analysis (all local)

---

## 14. Success Criteria

| Situation | Expected Result |
|---|---|
| Agent works normally | No loop detected |
| Same action repeated once | No immediate loop flag |
| Repeated same action without progress | Possible/Confirmed Loop |
| Different fixes → same error | Error Loop |
| Changes reverted repeatedly | Revert Loop |
| Context compaction → repetition | Context Loop |
| Many irrelevant actions, no goal progress | Rabbit Hole |
| Recovery brings progress | Recovery successful |
| 3 recovery attempts without progress | Agent stopped |
