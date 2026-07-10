# Layout Snap (Panels andocken)

**Kategorie:** 5. UI / UX | **Feature:** 5.2

## Ziel
Panels (Chat, Terminal, Docker, Git, Diff-Viewer) können in verschiedenen Layouts angeordnet und angedockt werden.

## Layout-Optionen
1. **Standard**: Chat links, Diff-Viewer rechts, Terminal unten
2. **Chat-zentriert**: Chat mittig (breit), Terminal unten, Diff-Viewer als Overlay
3. **Terminal-fokus**: Terminal groß (oben), Chat klein (unten links), Diff rechts
4. **Minimal**: Nur Chat (alles andere ausgeblendet)

## UI
- Layout-Buttons in der Titlebar (oder Command Palette)
- Aktuelles Layout wird im Settings > General gespeichert
- Jedes Panel kann per Drag an den Rand gezogen werden und "snappt" dort hin
- Panel-Größen werden per Drag-Resize gespeichert

## Implementation
- CSS-Klasse `body.layout-<name>` steuert Grid-Template
- Panel-Visibility via `hidden` class
- Resize-Handles via CSS `resize` oder JS Drag
- Layout wird in `settings.json` gespeichert
