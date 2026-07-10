# Makros / Tastaturkürzel individuell belegbar

**Kategorie:** 5. UI / UX | **Feature:** 5.6

## Ziel
Der Benutzer kann alle Tastaturkürzel selbst festlegen.

## UI (in Settings > Keybindings)
- Tabelle mit 3 Spalten: Aktion | Aktuelles Kürzel | Neues Kürzel
- Klick auf "Neues Kürzel" → Taste drücken → wird übernommen
- "Reset to Defaults" Button
- Suche nach Aktionen in der Tabelle

## Speicherung
- `keybindings.json` in `userData` (neben `settings.json`)
- Format:
  ```json
  [
    { "id": "settings.open", "keys": "Ctrl+," },
    { "id": "terminal.toggle", "keys": "Ctrl+`" }
  ]
  ```

## Implementation
- `loadKeybindings()` → merged User-Bindings mit DEFAULT_SHORTCUTS
- User-Bindings überschreiben Defaults
- Keybinding-Conflict-Erkennung (gleiches Kürzel für 2 Aktionen → Warnung)
- Im Renderer-Prozess: keydown-Handler checkt gegen gemergte Map
