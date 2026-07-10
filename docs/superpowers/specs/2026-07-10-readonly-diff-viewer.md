# Read-Only Collapsible Diff Viewer

**Kategorie:** 2. Editor | **Feature:** 2 (Editor Transformation)

## Ziel
Der Monaco-Editor als permanentes UI-Element wird entfernt. Stattdessen gibt es einen ausklappbaren, read-only Diff-Viewer, der nur sichtbar ist, wenn die AI Änderungen vornimmt.

## Änderungen
- **Weg**: Monaco-Editor als Hauptinhalt der App
- **Weg**: `#editor-container`, `#file-tabs`, `#sidebar` (file tree)
- **Neu**: Ausklappbarer `<div id="diff-viewer">` unterhalb des Chats
- **Neu**: Read-only — kein Cursor, keine Eingabe, keine Maus-Interaktion (`pointer-events: none`)
- **Neu**: "Read-Only"-Badge/Sichtbarer Indikator (z.B. Schloss-Icon + Text "Read-Only View")

## Diff-Viewer Verhalten
- Zeigt sich automatisch wenn AI `write_file` / `edit_file` ausführt
- Kann manuell über Button "Show Changes" / "Hide Changes" ein-/ausgeklappt werden
- Zeigt die geänderte Datei mit Syntax-Highlighting (read-only)
- Mehrere Datei-Änderungen werden als Tabs im Diff-Viewer angezeigt
- Jeder Tab zeigt Dateinamen + Status (Added / Modified / Deleted)
- Der Diff-Viewer selbst ist `pointer-events: none; user-select: text;` (Text kopierbar, aber nicht klickbar)

## Implementation
- Monaco wird als read-only Instanz geladen (`readOnly: true`, `domReadOnly: true`)
- `editor.onDidChangeModelContent` wird nicht mehr verwendet
- Kein File-Tree / keine Projekt-Navigation im UI
- App-View zeigt nur: Chat-Panel + (optional) Terminal-Panel + (optional) Diff-Viewer

## Entfallende Komponenten
- `#editor-container` → entfernt
- `.sidebar` → entfernt
- `#file-tabs` / `#file-name` → entfernt
- `.project-type-badge` → kann bleiben (wird anderswo platziert)
- `#project-name` im Titlebar → bleibt (zeigt aktuelles Projekt)
