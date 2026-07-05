# Plan 4: Editor & Fixes

**Files:**
- Modify: `App/renderer/script.js` — editor sync, download fix, confirmation descriptions
- Modify: `App/main.js` — file watcher or IPC for downloads
- Modify: `App/preload.js` — expose download API

## Tasks

### Task 1: Live Editor Sync
- When `projectWriteFile` is called by AI: immediately reload the file in open editor tab
- Use existing `openFile(path)` or `loadFileContent()` to refresh tab content without losing cursor position
- Add file watcher (via `fs.watch` in main process, IPC to renderer) for external changes
- When file changes detected: auto-reload if no unsaved changes, otherwise show "file changed" badge

### Task 2: Sandbox ZIP Download Fix
- Current: sandbox download shows folder picker but doesn't save
- Fix: use `dialog.showSaveDialog` or `dialog.showOpenDialog` (folder) + `fs.copyFile` to actually write the file
- IPC handler: `download-sandbox-file` — receives source path + target path, copies file
- Show progress notification during copy

### Task 3: AI-Generated Confirmation Descriptions
- Before shell/file operations: AI writes short summary (2-5 words)
- In permission/confirmation dialog:
  - Top: **Command/Operation** (what will execute)
  - Below: Summary description by AI ("Creates a new React component")
  - For shell: command at top, AI summary below
- Pass summary through `executeToolCall` to permission prompt
