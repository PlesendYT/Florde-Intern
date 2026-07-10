# To-Do Lists im Projekt

**Kategorie:** 6. Productivity | **Feature:** 6.1

## Ziel
Ein einfaches Task-Management pro Projekt. Der Benutzer kann To-Dos erfassen, abhaken und organisieren.

## UI
- Neues Panel "To-Dos" (umschaltbar via Button in Titlebar oder Command Palette)
- Liste mit Checkbox + Text + Priorität (Low/Medium/High)
- Input-Feld + "Add" Button am oberen Rand
- Filter: All / Active / Completed
- Sortierung: High → Medium → Low → (nach Erstellungsdatum)

## Daten
```json
[
  { "id": "uuid", "text": "Refactor login", "done": false, "priority": "high", "created": "2026-07-10T12:00:00Z" }
]
```

## Speicherung
- Pro Projekt: `.florde/todos.json`
- Session-übergreifend via `localStorage` (oder nur File-basiert)

## Implementation
- `todos.js` Modul mit CRUD-Operationen
- Rendering: einfache HTML-Liste, kein Framework
- Checkbox toggled `done` via Klick
- Delete-Button (X) pro Eintrag
- Drag to reorder (optional, kann später kommen)
