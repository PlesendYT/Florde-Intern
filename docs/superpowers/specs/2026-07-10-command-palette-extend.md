# Command Palette erweitern (alle Aktionen)

**Kategorie:** 5. UI / UX | **Feature:** 5.5

## Ziel
Die Command Palette (Strg+Shift+P) zeigt ALLE verfügbaren Aktionen der App, nicht nur vordefinierte Shortcuts.

## Neue Aktionen
- Settings önen
- Projekt wechseln
- Terminal önen/schließen
- Docker Panel önen/schließen
- Git Panel önen
- Layout wechseln (Standard / Chat-zentriert / ...)
- Theme wechseln
- Fullscreen umschalten
- Export Project
- Session speichern/laden
- "Clear Chat"
- "New Project"

## Implementation
- Command Registry als zentrale Datenstruktur:
  ```js
  const COMMANDS = {
    'settings.open': { label: 'Open Settings', keys: 'Ctrl+,', fn: ... },
    'project.switch': { label: 'Switch Project', fn: ... },
    ...
  }
  ```
- `CommandPalette.show()` liest aus COMMANDS
- Aktuelle `DEFAULT_SHORTCUTS` werden in COMMANDS integriert
- Jede Aktion hat: `id`, `label`, `keys` (optional), `fn`, `category`
- Kategorien: "AI", "View", "Project", "Terminal", "Git", "Docker", "Settings", "Help"
