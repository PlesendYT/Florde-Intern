# Split Terminal

**Kategorie:** 3. Terminal / Docker | **Feature:** 3.1

## Ziel
Mehrere Terminal-Instanzen gleichzeitig nebeneinander (horizontal/vertical split) im Terminal-Panel.

## UI
- Buttons in der Terminal-Toolbar: "Split Horizontal" (─), "Split Vertical" (│)
- Jeder Split hat eigenen Tab/Header mit Titel und Close-Button
- Splits sind per Drag-Resize in der Größe veränderbar (via CSS `resize` oder JS)

## Verhalten
- Jeder Split ist eine eigene `xterm.js`-Instanz mit eigenem Shell-Prozess
- Split schließen via Close-Button im Tab-Header
- Beim Schließen des letzten Splits wird das gesamte Terminal-Panel geschlossen
- Terminal-Shortcuts gelten nur für den aktiven Split (fokussiert)
- Aktiver Split wird durch farbigen Rahmen/Header hervorgehoben

## Implementation
- Terminal-Panel-Struktur ändern: `#terminal-container` → `#terminal-splits` mit flexbox
- Jeder Split: `<div class="terminal-split"><div class="terminal-header"><span class="terminal-title"/><button class="terminal-close"/></div><div class="terminal-instance"/></div>`
- Resize: `split.style.flex = '1 1 auto'` + Resize-Handler via mousedown/mousemove
- Max 4 Splits (2×2 Grid)
