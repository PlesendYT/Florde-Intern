# Fullscreen Mode

**Kategorie:** 5. UI / UX | **Feature:** 5.7

## Ziel
Die App kann in den Vollbildmodus geschaltet werden.

## Shortcut
- `F11` oder `Alt+Enter` toggled Fullscreen
- Button in Titlebar (neben Theme-Toggle)

## Implementation
- `mainWindow.setFullScreen(!mainWindow.isFullScreen())`
- IPC-Handler: `window:eletronAPI.setFullscreen(bool)` → `ipcMain.handle('set-fullscreen', ...)`
- Oder simpler: `document.documentElement.requestFullscreen()` im Renderer (geht in Electron)
- Beim Verlassen: `document.exitFullscreen()`
- State wird via `window.electronAPI.isFullScreen()` abgefragt
- Icon wechselt zwischen "Vollbild" (▢) und "Fenster" (⤡)

## UI
- Button in Titlebar: `#btn-fullscreen`
- Tooltip: "Toggle Fullscreen (F11)"
