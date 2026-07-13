# Enhanced Permission Prompt Design

## Goal
Replace the minimal AI permission prompt overlay with a detailed, information-rich interface showing exactly what the AI wants to do, why, and what the impact is — while adding user controls to modify or get more details about the request.

## Current State
`showPermissionPrompt(toolName, args, callback)` creates a floating overlay with:
- A short action description line (e.g., "The AI wants to write_file")
- Optional `args.description` shown as "Summary"
- Four buttons: Allow Once, Always Allow, Block Once, Always Block

## Requirements

1. **Rich action info per tool type:**
   - **read_file** → "Lesen" action, file path
   - **write_file** → "Schreiben" action, file path, line changes (+N / −M), reason
   - **edit_file** → "Bearbeiten" action, file path, line changes (+N / −M) from oldString vs newString, reason
   - **delete_file** → "Löschen" action, file path, reason
   - **rename_file** → "Umbenennen" action, old path, new path, reason
   - **exec_command** → "Ausführen" action, command, risk level, risk explanation
   - **ask_question** → "Fragen" action, question text
   - Other tools → tool name label, args summary

2. **Line diff display:**
   - `edit_file`: Count lines in `args.oldString` (removed, red) vs `args.newString` (added, green)
   - `write_file`: Count total lines in `args.content` → show "+N Zeilen" (green). Reading existing file for diff before permission is a privacy concern → skip it.
   - Color: green for additions, red for deletions

3. **Reason / Grund:** Display `args.description` as bold "Grund:" label

4. **Risk display:**
   - `exec_command`: Use `assessShellRisk()` result.
   - Other file operations: Default risk:
     - `delete_file` → "Hoch"
     - `write_file` / `edit_file` → "Mittel"
     - `read_file` → "Niedrig"
   - Show risk label with color badge (red/yellow/green)
   - Show a static risk explanation template per tool type below the risk badge

5. **Buttons:**
   - **Allow Once** — proceed with this single action
   - **Always Allow** — add permanent `allow` rule for this tool
   - **Block Once** — deny this action
   - **Always Block** — add permanent `block` rule for this tool
   - **Ändern** — let user type a modification request → send to AI via provider → get updated args → re-render prompt
   - **Detailierter erklären** — request detailed explanation from AI via `providers[active].sendPlain()` → show result in expandable section below the prompt (no chat, no interruption)

6. **"Ändern" flow:**
   - Click → overlay switches to a textarea: "Was soll anders sein?"
   - User types change request (e.g., "Mach 'Buy Now' statt 'Buy'")
   - Submit → sends to active provider via `sendPlain()` with context: last 3 chat messages + current tool request
   - Provider returns updated tool args (JSON). The prompt re-renders with the new args but same tool name.
   - The user sees updated file path, content, description, etc. before deciding allow/block.
   - User clicks allow/block as normal

7. **"Detailierter erklären" flow:**
   - Click → shows loading spinner in a collapsible section below the main prompt
   - Calls `providers[active].sendPlain()` with context: last 3 chat messages + current tool request + "Erkläre detailliert was du mit diesem Tool-Call erreichen willst."
   - Renders response as formatted text in the collapsible section
   - Does NOT block/interrupt the AI — user can still click allow/block while loading

8. **Visual layout:**
   ```
   ┌────────────────────────────────────────┐
   │ 🔒 AI-Zugriffsanfrage                   │
   │                                        │
   │ ✏️ Schreiben                            │
   │ 📄 Datei: src/file.ts                   │
   │ 📊 +34 Zeilen, -8 Zeilen               │
   │                                        │
   │ 💬 Grund: Security Manager erweitern    │
   │ ⚠️ Risiko: Mittel                       │
   │ ℹ️ Erklärung: ...                       │
   │                                        │
   │ [✏️ Ändern] [🔍 Detailierter erklären] │
   │ ─── ─── ─── ─── ─── ─── ─── ─── ─── │
   │ [✅ Allow Once] [✅ Always Allow]      │
   │ [❌ Block Once] [❌ Always Block]      │
   └────────────────────────────────────────┘
   ```

## Implementation Notes

- Build directly into existing `showPermissionPrompt()` function in `App/renderer/script.js`
- Extend `formatToolActivity()` to return structured data (action label, icon, path, changes, risk)
- Reuse existing CSS classes; extend `.permission-prompt` with new sub-elements
- "Detailierter erklären" uses AbortSignal timeout (30s) to avoid hanging
- "Ändern" uses AbortSignal timeout (30s) to avoid hanging
- Both AI calls should show a loading indicator
- The risk explanation for non-shell tools can be derived: e.g., "Die KI möchte eine Datei schreiben. Dies kann bestehenden Code überschreiben."

## Files to Modify
- `App/renderer/script.js` — `showPermissionPrompt()`, CSS class references
- `App/renderer/style.css` — new sub-element styles for rich prompt layout
