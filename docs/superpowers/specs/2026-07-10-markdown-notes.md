# Notizen / Markdown Notes

**Kategorie:** 6. Productivity | **Feature:** 6.2

## Ziel
Der Benutzer kann Markdown-Notizen pro Projekt erstellen und verwalten.

## UI
- Neues Panel "Notes" (neben To-Dos, Terminal, etc.)
- Split-Panel: Links Datei-Liste, rechts Editor (read-only oder editierbar?)
- **Entscheidung**: Notizen sind editierbar (einfaches Textarea) — der Benutzer muss selbst Notizen schreiben können
- Neue Note via "New Note" Button
- Note löschen via "Delete" Button
- Notes werden als `.md` Dateien in `.florde/notes/` gespeichert

## Features
- Live Vorschau: Textarea links, gerenderte Markdown-Vorschau rechts
- Oder simpler: Nur Textarea + "Preview" Toggle
- Dateiname = Notiz-Titel (erste Zeile der .md Datei)
- Liste zeigt alle `.md` Dateien in `.florde/notes/`

## Implementation
- Notes-Liste via `fs.readdirSync('.florde/notes/')`
- Notiz laden/speichern via `projectReadFile` / `projectWriteFile`
- Markdown-Rendering via einfachem Regex-Replace (keine externe Lib)
- Unterstützt: `# h1`, `## h2`, `**bold**`, `*italic*`, `` `code` ``, `- list`, `> quote`
