# Plan 2: Chat & UI Enhancements

**Files:**
- Modify: `App/renderer/script.js` — chat rendering, settings, activity display
- Modify: `App/renderer/index.html` — settings toggles, collapsible toolbar, ollama dropdown
- Modify: `App/renderer/style.css` — thinking text, activity, toolbar styles
- Modify: `Website/index.html` — ollama tool note
- Modify: `Website/style.css` — if needed

## Tasks

### Task 1: See Thoughts
- Add toggle "See Thoughts" to settings (default: ON)
- AI generates thinking markers in response: starts with `[think]`, ends with `[/think]`
- In `appendMessage`/chat render: parse `[think]...[/think]` blocks
- Render thinking text gray + italic (`color: var(--text3)`), normal response below
- When toggle OFF: strip thinking blocks entirely

### Task 2: Instant Mode
- Add toggle "Instant Mode" to settings
- When ON: buffer complete AI response, render all at once when done
- When OFF: after response received, animate character-by-character into chat
- Typing animation: `setInterval` adding chars, cursor blink at end
- Tool calls and results appear inline during animation

### Task 3: AI Activity Display
- During AI response: insert activity message in chat (system style, small gray text)
- Updates live: `Reading file.js`, `Editing file.js`, `SHELL: npm install`, `Waiting (Rate Limit) Retry in 5s`
- AI writes short activity status → appears in this line
- Activity line replaces previous activity, doesn't create new messages

### Task 4: Collapsible Toolbar
- Wrap top function bar in collapsible container
- Button on right side: `◀` / `▶` arrow
- Default state: collapsed (only button visible)
- State persisted in localStorage

### Task 5: Ollama Model Selector in Settings
- In Ollama provider settings: dropdown arrow next to model input
- On click: fetch `ollama list` via IPC, show installed models
- Bottom entry: "Download Model"
- Download modal: search field, known models list, manual name input
- Validate model name (check against Ollama library), show progress bar during pull

### Task 6: Website Ollama Tool Note
- In `Website/index.html`: add feature note that Florde enables tool use even for Ollama models without native tool support
- Place in features or description section
