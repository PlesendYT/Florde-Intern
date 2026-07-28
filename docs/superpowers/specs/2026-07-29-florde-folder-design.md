# .florde Project Folder System

## Overview

Every Florde project gets a `.florde/` folder in its project root directory. This folder replaces localStorage for per-project data and adds AI memory/temp systems.

## Folder Structure

```
projectpath/.florde/
├── memory/
│   ├── rules.md            (READONLY — only user can edit)
│   ├── memory.md           (AI-managed)
│   ├── goals.md            (AI-managed)
│   ├── style.md            (AI-managed)
│   ├── architecture.md     (AI-managed)
│   └── decisions.md        (AI-managed)
├── temp/
│   ├── checklist-xxx.md
│   └── temp-note-yyy.md
├── state.db                (SQLite: settings, todos, notes, decisions, audit, layout, time)
└── .gitignore              (optional: *.db, temp/*)
```

## SQLite Schema (state.db)

```sql
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE todos (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT, done INTEGER DEFAULT 0, created_at TEXT);
CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, content TEXT, updated_at TEXT);
CREATE TABLE decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, decision TEXT, context TEXT, date TEXT);
CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, detail TEXT, timestamp TEXT);
CREATE TABLE layout_states (name TEXT PRIMARY KEY, state_json TEXT);
CREATE TABLE time_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, start TEXT, end TEXT, total_seconds INTEGER);
CREATE TABLE time_summary (date TEXT, seconds INTEGER, PRIMARY KEY (date));
```

## .florde Folder Creation & Detection Flow

### On project creation (openProject with new project)
1. Prompt user: "`.florde/` Ordner für dieses Projekt erstellen?"
2. If yes → `projectDb.init(projectPath)` creates `state.db` tables and `memory/rules.md`
3. If no → project opens without `.florde/`, all data stays in localStorage

### On project open (existing project)
1. Check if `projectpath/.florde/` exists
2. If yes → automatically use it, load data from `state.db`
3. If no → prompt: "Kein `.florde/` gefunden — Neu erstellen + localStorage migrieren?"
   - Yes: create `.florde/`, copy all localStorage data into `state.db`
   - No: open without `.florde/` (keep localStorage)

### Management Panel buttons
- "`.florde/` importieren" — localStorage → `.florde/state.db`
- "`.florde/` exportieren" — `.florde/state.db` → localStorage
- "`.florde/` entfernen" — delete `.florde/`, data back to localStorage

## Rules.md Protection

Enforced in the main process (`App/main.js`). Every `projectWriteFile` call is checked:

```javascript
const normalizedPath = filePath.replace(/\\/g, '/');
if (normalizedPath.includes('/.florde/memory/rules.md')) {
  throw new Error('rules.md is read-only — edit directly in the file system');
}
```

Blocked:
- AI tool calls (go through `projectWriteFile` IPC)
- Plugins
- Florde system processes
- Florde UI "Save" button

Allowed:
- Manual editing in filesystem (VS Code, nano, etc.)
- "Edit rules.md" button that opens the file in the default system editor

## Memory System

### Files
- `rules.md` — protected, user-only editable
- `memory.md` — general project context
- `goals.md` — project goals
- `style.md` — coding style rules (AI populates based on project analysis)
- `architecture.md` — architecture decisions
- `decisions.md` — technical decisions

### AI Access
- Every chat message gets ALL memory files injected as system context
- AI can create new `.md` files and edit existing ones (except `rules.md`)
- AI can request to read specific memory files at any time

### Initial State
- Only `rules.md` is auto-created (empty with a comment header)
- Other files are created by AI when needed

## Temp Notes System

### Location
- Primary: `projectpath/.florde/temp/`
- Fallback (no `.florde/`): `AppData/Local/Temp/Florde/` (configurable)

### Content
- Checklists with progress
- Intermediate states
- Temporary "merke dass..." notes
- AI task tracking

### Lifecycle
- Created by AI via `projectWriteFile`
- AI can delete temp files itself
- After 5h or feature completion: prompt "Temp-Datei XYZ noch benötigt?"
- Manual deletion via Temp overview in Management panel
- Deleted when no longer useful

### Display
- Temp overview in Management → Temp tab
- Shows: filename, size, creation date
- Delete button per file

## Integration

### New IPC Methods (preload.js → main.js)

```javascript
flordeProject: {
  init: (projectPath) => ipcRenderer.invoke('florde-project:init', projectPath),
  exists: (projectPath) => ipcRenderer.invoke('florde-project:exists', projectPath),
  remove: (projectPath) => ipcRenderer.invoke('florde-project:remove', projectPath),
  run: (projectPath, sql, params) => ipcRenderer.invoke('florde-project:run', projectPath, sql, params),
  query: (projectPath, sql, params) => ipcRenderer.invoke('florde-project:query', projectPath, sql, params),
  migrateFromLocalStorage: (projectPath, data) => ipcRenderer.invoke('florde-project:migrate', projectPath, data),
}
```

### Main Process Handlers

```javascript
// florde-project:init — create .florde/ folder, state.db tables, memory/rules.md
// florde-project:exists — check if .florde/ exists
// florde-project:remove — delete .florde/ folder entirely
// florde-project:run — execute SQL on project's state.db
// florde-project:query — query project's state.db
// florde-project:migrate — import data from renderer into state.db
```

### Renderer Changes (script.js)

- `openProject()`: check `.florde/` existence, load from `state.db` instead of localStorage
- `TodoList.save/load`: target `state.db` instead of `florde-todos-<project>`
- `Notes.save/load`: target `state.db` instead of `florde-notes-<project>`
- `DecisionLog.save/load`: target `state.db` instead of `florde-decisions-<project>`
- `AuditLog.save/load`: target `state.db` instead of `florde-audit-<project>`
- `LayoutManager.save/load`: target `state.db` instead of localStorage
- `TimeTracking`: target `state.db` instead of existing storage

### Chat Integration

- On sending a message: read all `.florde/memory/*.md` files and inject as system context
- Chat command "/merke dass..." → create temp note
- Chat command "/erledigt <file>" → delete or check off temp file
- Chat command "/memory" → list all memory files

### Rules.md Protection in main.js

The existing `projectWriteFile` IPC handler checks for `/.florde/memory/rules.md` in the path and rejects writes.

## Platform Support

- Local projects (real filesystem path): `.florde/` in project root
- Sandbox projects (app data): `.florde/` in project sandbox directory (same logic applies)
- Temp fallback: `AppData/Local/Temp/Florde/` on Windows, `~/.cache/florde/temp/` on Linux/macOS
